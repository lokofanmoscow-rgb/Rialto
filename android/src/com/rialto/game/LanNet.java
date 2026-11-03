package com.rialto.game;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Сетевое ядро игры по локальной сети (без зависимостей от Android).
 * Хост: TCP-сервер, сообщения — строки JSON, разделённые переводом строки.
 * Обнаружение: хост отвечает на UDP-запросы и рассылает широковещательные «маяки».
 */
public class LanNet {
    public interface Listener { void onEvent(String type, String a, String b); }

    public static final int DISCOVER_PORT = 47322;   // хост слушает запросы
    public static final int BEACON_PORT = 47323;     // клиенты слушают маяки
    private static final String DISCOVER = "RIALTO_DISCOVER";
    private static final String HOST_PREFIX = "RIALTO_HOST ";
    private static final int HEARTBEAT_MS = 4000;
    private static final int READ_TIMEOUT_MS = 16000;

    private final Listener listener;
    private final ExecutorService sendExec = Executors.newSingleThreadExecutor();

    // хост
    private volatile ServerSocket server;
    private volatile DatagramSocket hostUdp;
    private volatile String hostInfo = "{}";
    private volatile int hostPort;
    private final Map<String, Conn> clients = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);

    // клиент
    private volatile Conn client;
    private volatile int clientGen = 0;

    // обнаружение
    private volatile DatagramSocket discSock;

    public LanNet(Listener l) { this.listener = l; }

    private void emit(String type, String a, String b) {
        try { listener.onEvent(type, a, b); } catch (Throwable t) { t.printStackTrace(); }
    }

    /** Одно TCP-соединение */
    private final class Conn {
        final String id;
        final Socket sock;
        final OutputStream out;
        volatile boolean closed;
        Conn(String id, Socket s) throws IOException {
            this.id = id;
            this.sock = s;
            s.setTcpNoDelay(true);
            s.setKeepAlive(true);
            s.setSoTimeout(READ_TIMEOUT_MS);
            this.out = s.getOutputStream();
        }
        void write(String line) {
            if (closed) return;
            try {
                synchronized (out) {
                    out.write(line.getBytes(StandardCharsets.UTF_8));
                    out.write('\n');
                    out.flush();
                }
            } catch (IOException e) { close(); }
        }
        void close() {
            if (closed) return;
            closed = true;
            try { sock.close(); } catch (IOException ignored) { }
        }
    }

    // ───────────────────────── Хост ─────────────────────────

    public synchronized boolean hostStart(int port, String info) {
        hostStop();
        try {
            ServerSocket ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(port));
            server = ss;
            hostPort = port;
            hostInfo = info == null ? "{}" : info;
        } catch (IOException e) {
            emit("hostError", "Не удалось открыть порт " + port + ": " + e.getMessage(), "");
            return false;
        }
        final ServerSocket ss = server;
        Thread acc = new Thread(() -> acceptLoop(ss), "rialto-accept");
        acc.setDaemon(true);
        acc.start();
        // «пульс» клиентам, чтобы соединение не считалось мёртвым
        Thread hb = new Thread(() -> {
            while (server == ss && !ss.isClosed()) {
                for (Conn c : clients.values()) sendExec.execute(() -> c.write(""));
                try { Thread.sleep(HEARTBEAT_MS); } catch (InterruptedException e) { break; }
            }
        }, "rialto-host-hb");
        hb.setDaemon(true);
        hb.start();
        startHostUdp();
        return true;
    }

    public void hostUpdate(String info) { if (info != null) hostInfo = info; }

    private void acceptLoop(ServerSocket ss) {
        while (!ss.isClosed()) {
            try {
                Socket s = ss.accept();
                final String id = "c" + nextId.getAndIncrement();
                final Conn c = new Conn(id, s);
                clients.put(id, c);
                emit("hostClient", id, s.getInetAddress().getHostAddress());
                Thread t = new Thread(() -> readLoop(c, true), "rialto-client-" + id);
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (ss.isClosed()) break;
            }
        }
    }

    private void readLoop(Conn c, boolean hostSide) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(c.sock.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (!c.closed) {
                try {
                    line = in.readLine();
                } catch (SocketTimeoutException te) {
                    break; // нет даже «пульса» — соединение мертво
                }
                if (line == null) break;
                if (line.isEmpty()) continue; // heartbeat
                if (hostSide) emit("hostMsg", c.id, line);
                else emit("clientMsg", line, "");
            }
        } catch (IOException ignored) {
        } finally {
            c.close();
            if (hostSide) {
                if (clients.remove(c.id) != null) emit("hostLeave", c.id, "");
            } else if (client == c) {
                client = null;
                emit("clientClose", "Соединение потеряно", "");
            }
        }
    }

    public void hostSend(String id, String text) {
        final Conn c = clients.get(id);
        if (c == null) return;
        sendExec.execute(() -> c.write(text));
    }

    public void hostKick(String id) {
        final Conn c = clients.get(id);
        if (c != null) sendExec.execute(c::close);
    }

    public synchronized void hostStop() {
        ServerSocket ss = server;
        server = null;
        if (ss != null) try { ss.close(); } catch (IOException ignored) { }
        DatagramSocket u = hostUdp;
        hostUdp = null;
        if (u != null) u.close();
        for (Conn c : clients.values()) c.close();
        clients.clear();
    }

    private String beaconText() {
        String info = hostInfo;
        // добавляем порт в JSON-объект
        String body = info.trim();
        if (body.startsWith("{") && body.length() > 1) {
            String inner = body.substring(1).trim();
            body = "{\"port\":" + hostPort + (inner.startsWith("}") ? "" : ",") + inner;
        }
        return HOST_PREFIX + body;
    }

    private void startHostUdp() {
        try {
            DatagramSocket u = new DatagramSocket(null);
            u.setReuseAddress(true);
            u.setBroadcast(true);
            u.bind(new InetSocketAddress(DISCOVER_PORT));
            hostUdp = u;
        } catch (IOException e) {
            emit("hostError", "Обнаружение недоступно: " + e.getMessage(), "");
            return;
        }
        final DatagramSocket u = hostUdp;
        // ответы на запросы
        Thread rx = new Thread(() -> {
            byte[] buf = new byte[512];
            while (!u.isClosed()) {
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    u.receive(p);
                    String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    if (msg.startsWith(DISCOVER)) {
                        byte[] reply = beaconText().getBytes(StandardCharsets.UTF_8);
                        u.send(new DatagramPacket(reply, reply.length, p.getAddress(), p.getPort()));
                    }
                } catch (IOException e) {
                    if (u.isClosed()) break;
                }
            }
        }, "rialto-udp-rx");
        rx.setDaemon(true);
        rx.start();
        // периодические маяки
        Thread tx = new Thread(() -> {
            while (!u.isClosed()) {
                byte[] data = beaconText().getBytes(StandardCharsets.UTF_8);
                for (InetAddress b : broadcastAddresses()) {
                    try { u.send(new DatagramPacket(data, data.length, b, BEACON_PORT)); } catch (IOException ignored) { }
                }
                try { Thread.sleep(2000); } catch (InterruptedException e) { break; }
            }
        }, "rialto-udp-tx");
        tx.setDaemon(true);
        tx.start();
    }

    // ───────────────────────── Обнаружение ─────────────────────────

    public synchronized void discoverStart() {
        discoverStop();
        try {
            DatagramSocket s = new DatagramSocket(null);
            s.setReuseAddress(true);
            s.setBroadcast(true);
            s.bind(new InetSocketAddress(BEACON_PORT));
            discSock = s;
        } catch (IOException e) {
            try {
                DatagramSocket s = new DatagramSocket();
                s.setBroadcast(true);
                discSock = s;
            } catch (IOException e2) {
                emit("discoverError", e2.getMessage(), "");
                return;
            }
        }
        final DatagramSocket s = discSock;
        Thread rx = new Thread(() -> {
            byte[] buf = new byte[2048];
            while (!s.isClosed()) {
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    if (msg.startsWith(HOST_PREFIX)) {
                        String json = msg.substring(HOST_PREFIX.length()).trim();
                        String ip = p.getAddress().getHostAddress();
                        if (json.startsWith("{")) json = "{\"ip\":\"" + ip + "\"," + json.substring(1);
                        emit("found", json, ip);
                    }
                } catch (IOException e) {
                    if (s.isClosed()) break;
                }
            }
        }, "rialto-disc-rx");
        rx.setDaemon(true);
        rx.start();
        Thread tx = new Thread(() -> {
            byte[] q = DISCOVER.getBytes(StandardCharsets.UTF_8);
            while (!s.isClosed()) {
                for (InetAddress b : broadcastAddresses()) {
                    try { s.send(new DatagramPacket(q, q.length, b, DISCOVER_PORT)); } catch (IOException ignored) { }
                }
                try { Thread.sleep(1500); } catch (InterruptedException e) { break; }
            }
        }, "rialto-disc-tx");
        tx.setDaemon(true);
        tx.start();
    }

    public synchronized void discoverStop() {
        DatagramSocket s = discSock;
        discSock = null;
        if (s != null) s.close();
    }

    // ───────────────────────── Клиент ─────────────────────────

    public void connect(final String host, final int port) {
        clientClose();
        final int gen = ++clientGen;
        Thread t = new Thread(() -> {
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, port), 6000);
                if (gen != clientGen) { s.close(); return; }
                final Conn c = new Conn("host", s);
                client = c;
                emit("clientOpen", host, "");
                Thread hb = new Thread(() -> {
                    while (!c.closed) {
                        sendExec.execute(() -> c.write(""));
                        try { Thread.sleep(HEARTBEAT_MS); } catch (InterruptedException e) { break; }
                    }
                }, "rialto-hb");
                hb.setDaemon(true);
                hb.start();
                readLoop(c, false);
            } catch (IOException e) {
                if (gen == clientGen) emit("clientClose", "Не удалось подключиться: " + e.getMessage(), "");
            }
        }, "rialto-connect");
        t.setDaemon(true);
        t.start();
    }

    public void clientSend(String text) {
        final Conn c = client;
        if (c != null) sendExec.execute(() -> c.write(text));
    }

    public void clientClose() {
        clientGen++;
        Conn c = client;
        client = null;
        if (c != null) c.close();
    }

    public void shutdown() {
        hostStop();
        discoverStop();
        clientClose();
        sendExec.shutdownNow();
    }

    // ───────────────────────── Адреса ─────────────────────────

    public static List<InetAddress> broadcastAddresses() {
        List<InetAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null && !out.contains(b)) out.add(b);
                }
            }
        } catch (Exception ignored) { }
        try {
            InetAddress all = InetAddress.getByName("255.255.255.255");
            if (!out.contains(all)) out.add(all);
        } catch (Exception ignored) { }
        return out;
    }

    /** Список IPv4-адресов устройства в виде JSON-массива строк */
    public static String localIps() {
        StringBuilder sb = new StringBuilder("[");
        try {
            boolean first = true;
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    if (!first) sb.append(',');
                    sb.append('"').append(a.getHostAddress()).append('"');
                    first = false;
                }
            }
        } catch (Exception ignored) { }
        return sb.append(']').toString();
    }
}

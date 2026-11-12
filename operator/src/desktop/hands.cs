// JARVIS's hands on Windows — a small program JARVIS builds on your laptop (with Windows' own C# compiler)
// and keeps running while it works: the "JARVIS is working" frame + bar, screenshots, mouse & keyboard,
// opening apps, reading on-screen buttons, and placing / ending calls in Phone Link or WhatsApp Desktop.
// It replaces a PowerShell script that antivirus software blocks. Fixed code: requests arrive as data.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;
#if UIA
using System.Windows.Automation;
#endif

public class JvGlass : Form {
  public bool ClickThrough = true;
  public JvGlass() {
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
    StartPosition = FormStartPosition.Manual; Opacity = 0;
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x80 | 0x08000000; // tool window, never takes focus
      if (ClickThrough) cp.ExStyle |= 0x80000 | 0x20; // layered + clicks pass through
      return cp;
    }
  }
}

public class JvRipple : JvGlass {
  int step = 0;
  System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
  public JvRipple(int x, int y) {
    Width = 90; Height = 90; Left = x - 45; Top = y - 45;
    BackColor = Color.Black; TransparencyKey = Color.Black; Opacity = 0.95; DoubleBuffered = true;
    t.Interval = 25;
    t.Tick += delegate { step++; Opacity = Math.Max(0, 0.95 - step * 0.045); Invalidate(); if (step >= 22) { t.Stop(); Close(); } };
    t.Start();
  }
  protected override void OnPaint(PaintEventArgs e) {
    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
    float r = 6 + step * 1.8f;
    using (Pen p = new Pen(Color.FromArgb(103, 232, 249), 3)) e.Graphics.DrawEllipse(p, 45 - r, 45 - r, 2 * r, 2 * r);
    using (Brush b = new SolidBrush(Color.FromArgb(165, 243, 252))) e.Graphics.FillEllipse(b, 41, 41, 8, 8);
  }
}

public class JvPill : JvGlass {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  public Label Text1 = new Label();
  public Panel Dot = new Panel();
  public Button Stop = new Button(), Yes = new Button(), No = new Button();
  public string AskId = null;
  public JvPill() {
    ClickThrough = false;
    BackColor = Color.FromArgb(6, 14, 24); Width = 620; Height = 50; DoubleBuffered = true;
    Font = new Font("Segoe UI", 10f);
    Dot.SetBounds(18, 20, 10, 10); Dot.BackColor = Color.FromArgb(34, 211, 238);
    GraphicsPath dp = new GraphicsPath(); dp.AddEllipse(0, 0, 10, 10); Dot.Region = new Region(dp);
    Text1.ForeColor = Color.FromArgb(230, 251, 255); Text1.AutoEllipsis = true; Text1.SetBounds(38, 0, 470, 50); Text1.TextAlign = ContentAlignment.MiddleLeft;
    Style(Stop, "Stop", Color.FromArgb(239, 68, 68)); Stop.SetBounds(520, 9, 84, 32);
    Style(Yes, "Yes, go ahead", Color.FromArgb(6, 182, 212)); Style(No, "No", Color.FromArgb(71, 85, 105));
    Controls.Add(Dot); Controls.Add(Text1); Controls.Add(Stop); Controls.Add(Yes); Controls.Add(No);
    Yes.Visible = false; No.Visible = false;
  }
  static void Style(Button b, string t, Color c) {
    b.Text = t; b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = 0; b.BackColor = c; b.ForeColor = Color.White;
    b.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold); b.Cursor = Cursors.Hand; b.TabStop = false;
  }
  public void Layout2(bool asking) {
    Rectangle wa = Screen.PrimaryScreen.WorkingArea;
    Height = asking ? 96 : 50;
    Left = wa.Left + (wa.Width - Width) / 2; Top = wa.Bottom - Height - 24;
    Text1.SetBounds(38, 0, asking ? 560 : 470, asking ? 54 : 50);
    Stop.Visible = !asking; Yes.Visible = asking; No.Visible = asking;
    Yes.SetBounds(Width - 290, 56, 150, 30); No.SetBounds(Width - 130, 56, 110, 30);
    GraphicsPath p = new GraphicsPath(); int r = 24;
    p.AddArc(0, 0, r, r, 180, 90); p.AddArc(Width - r - 1, 0, r, r, 270, 90); p.AddArc(Width - r - 1, Height - r - 1, r, r, 0, 90); p.AddArc(0, Height - r - 1, r, r, 90, 90); p.CloseFigure();
    Region = new Region(p);
  }
  protected override void OnPaint(PaintEventArgs e) {
    using (Pen pen = new Pen(Color.FromArgb(150, 34, 211, 238), 2)) e.Graphics.DrawRectangle(pen, 1, 1, Width - 3, Height - 3);
  }
  protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); try { RegisterHotKey(Handle, 1, 0x0001 | 0x0002 | 0x4000, 0x08); } catch (Exception) { } } // Ctrl+Alt+Backspace
  protected override void WndProc(ref Message m) { if (m.Msg == 0x0312) JvOverlay.Emit("stop"); base.WndProc(ref m); }
}

public static class JvOverlay {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  static JvPill pill; static JvGlass[] edges; static double target = 0, level = 0; static int tick = 0;
  static readonly object outLock = new object();

  public static void Emit(string line) { lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); } }

  public static void Run() {
    try { SetProcessDPIAware(); } catch (Exception) { }
    Application.EnableVisualStyles();
    pill = new JvPill();
    pill.Stop.Click += delegate { Emit("stop"); };
    pill.Yes.Click += delegate { Answer(true); };
    pill.No.Click += delegate { Answer(false); };
    IntPtr force = pill.Handle; // hotkey + Invoke need the window to exist
    Rectangle b = Screen.PrimaryScreen.Bounds; int th = 4;
    edges = new JvGlass[4];
    Rectangle[] rs = { new Rectangle(b.Left, b.Top, b.Width, th), new Rectangle(b.Left, b.Bottom - th, b.Width, th), new Rectangle(b.Left, b.Top, th, b.Height), new Rectangle(b.Right - th, b.Top, th, b.Height) };
    for (int i = 0; i < 4; i++) { edges[i] = new JvGlass(); edges[i].BackColor = Color.FromArgb(34, 211, 238); edges[i].Bounds = rs[i]; IntPtr h = edges[i].Handle; }
    System.Windows.Forms.Timer t = new System.Windows.Forms.Timer(); t.Interval = 30; t.Tick += delegate { Animate(); }; t.Start();
    Thread reader = new Thread(Read); reader.IsBackground = true; reader.Start();
    Emit("ready");
    Application.Run(new ApplicationContext());
  }

  static void Answer(bool yes) {
    if (pill.AskId == null) return;
    Emit("answer\t" + pill.AskId + "\t" + (yes ? "yes" : "no"));
    pill.AskId = null; pill.Layout2(false);
  }

  static void Animate() {
    tick++;
    level += (target - level) * 0.18;
    if (Math.Abs(target - level) < 0.01) level = target;
    double pulse = level * (0.72 + 0.22 * Math.Sin(tick * 0.11));
    bool vis = level > 0.01;
    foreach (JvGlass e in edges) { if (vis && !e.Visible) e.Show(); if (!vis && e.Visible) e.Hide(); if (vis) e.Opacity = pulse; }
    if (vis && !pill.Visible) pill.Show(); if (!vis && pill.Visible) pill.Hide();
    if (vis) { pill.Opacity = Math.Min(0.97, level); pill.Dot.Visible = (tick / 12) % 2 == 0; pill.TopMost = true; }
  }

  /** What's on the screen (real pixels), shrunk for the AI: a JPEG at most 1366 wide. */
  static void Shot(string id) {
    try {
      Rectangle b = Screen.PrimaryScreen.Bounds;
      using (Bitmap full = new Bitmap(b.Width, b.Height)) {
        using (Graphics g = Graphics.FromImage(full)) g.CopyFromScreen(b.X, b.Y, 0, 0, full.Size);
        int w = Math.Min(1366, b.Width); int h = (int)Math.Round((double)b.Height * w / b.Width);
        using (Bitmap img = new Bitmap(w, h)) {
          using (Graphics g2 = Graphics.FromImage(img)) { g2.InterpolationMode = InterpolationMode.HighQualityBicubic; g2.DrawImage(full, 0, 0, w, h); }
          ImageCodecInfo enc = null;
          foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") enc = c;
          EncoderParameters ps = new EncoderParameters(1);
          ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
          using (MemoryStream ms = new MemoryStream()) {
            img.Save(ms, enc, ps);
            string f = ((double)b.Width / w).ToString(System.Globalization.CultureInfo.InvariantCulture);
            Emit("shot\t" + id + "\t" + w + "\t" + h + "\t" + f + "\t" + Convert.ToBase64String(ms.ToArray()));
          }
        }
      }
    } catch (Exception ex) { Emit("shoterr\t" + id + "\t" + ex.Message.Replace("\t", " ").Replace("\r", " ").Replace("\n", " ")); }
  }

  /** One request on its own STA thread (UI Automation and the Shell need STA); the answer goes back with its id. */
  static void RunOp(string id, string json) {
    Thread t = new Thread(delegate () {
      string res;
      try { res = Json.Write(Hands.Run((Dictionary<string, object>)Json.Parse(json))); }
      catch (Exception ex) { Dictionary<string, object> e = new Dictionary<string, object>(); e["ok"] = false; e["error"] = ex.GetType().Name + ": " + ex.Message; res = Json.Write(e); }
      Emit("res	" + id + "	" + res);
    });
    t.SetApartmentState(ApartmentState.STA); t.IsBackground = true; t.Start();
  }

  static void Read() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string[] p = line.Split('\t');
      string cmd = p[0];
      if (cmd == "exit") break;
      if (cmd == "shot") { Shot(p.Length > 1 ? p[1] : "s"); continue; }
      if (cmd == "op" && p.Length > 2) { RunOp(p[1], string.Join("	", p, 2, p.Length - 2)); continue; }
      pill.BeginInvoke((MethodInvoker)delegate { Handle(cmd, p); });
    }
    pill.BeginInvoke((MethodInvoker)delegate { Application.Exit(); });
  }

  static void Handle(string cmd, string[] p) {
    if (cmd == "show") { if (pill.AskId == null) { pill.Layout2(false); pill.Text1.Text = "JARVIS is working" + (p.Length > 1 && p[1] != "" ? "  —  " + p[1] : ""); } target = 1; }
    else if (cmd == "hide") { if (pill.AskId == null) target = 0; }
    else if (cmd == "ripple" && p.Length > 2) { int x, y; if (int.TryParse(p[1], out x) && int.TryParse(p[2], out y)) new JvRipple(x, y).Show(); }
    else if (cmd == "ask" && p.Length > 2) {
      pill.AskId = p[1]; pill.Layout2(true);
      pill.Text1.Text = "JARVIS asks: " + p[2] + (p.Length > 3 && p[3] != "" ? "\n" + p[3] : "");
      target = 1; pill.Activate();
    }
  }
}

// ---------------------------------------------------------------------------
// JARVIS's hands: the screen, mouse, keyboard, apps and call buttons.
// One request per line on stdin: op<TAB>id<TAB>{json}; one answer per line on
// stdout: res<TAB>id<TAB>{json}. Each request runs on its own STA thread.
// ---------------------------------------------------------------------------
public static class Json {
  public static object Parse(string s) { int i = 0; object v = Val(s, ref i); return v; }
  static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
  static object Val(string s, ref int i) {
    Ws(s, ref i);
    if (i >= s.Length) return null;
    char c = s[i];
    if (c == '{') {
      Dictionary<string, object> d = new Dictionary<string, object>(); i++;
      Ws(s, ref i); if (i < s.Length && s[i] == '}') { i++; return d; }
      while (i < s.Length) {
        Ws(s, ref i); string k = Str(s, ref i); Ws(s, ref i); i++; // :
        d[k] = Val(s, ref i); Ws(s, ref i);
        if (i < s.Length && s[i] == ',') { i++; continue; }
        i++; break; // }
      }
      return d;
    }
    if (c == '[') {
      List<object> l = new List<object>(); i++;
      Ws(s, ref i); if (i < s.Length && s[i] == ']') { i++; return l; }
      while (i < s.Length) { l.Add(Val(s, ref i)); Ws(s, ref i); if (i < s.Length && s[i] == ',') { i++; continue; } i++; break; }
      return l;
    }
    if (c == '"') return Str(s, ref i);
    if (s.Substring(i).StartsWith("true")) { i += 4; return true; }
    if (s.Substring(i).StartsWith("false")) { i += 5; return false; }
    if (s.Substring(i).StartsWith("null")) { i += 4; return null; }
    int st = i; while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
    double n; double.TryParse(s.Substring(st, i - st), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out n);
    return n;
  }
  static string Str(string s, ref int i) {
    StringBuilder b = new StringBuilder(); i++; // opening quote
    while (i < s.Length && s[i] != '"') {
      char c = s[i++];
      if (c != '\\') { b.Append(c); continue; }
      char e = s[i++];
      switch (e) {
        case 'n': b.Append('\n'); break; case 't': b.Append('\t'); break; case 'r': b.Append('\r'); break;
        case 'b': b.Append('\b'); break; case 'f': b.Append('\f'); break;
        case 'u': b.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
        default: b.Append(e); break;
      }
    }
    i++; return b.ToString();
  }
  public static string Write(object v) {
    if (v == null) return "null";
    if (v is bool) return (bool)v ? "true" : "false";
    if (v is string) return Q((string)v);
    if (v is int || v is long) return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
    if (v is double || v is float) return Convert.ToDouble(v).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
    if (v is Dictionary<string, object>) {
      List<string> parts = new List<string>();
      foreach (KeyValuePair<string, object> kv in (Dictionary<string, object>)v) parts.Add(Q(kv.Key) + ":" + Write(kv.Value));
      return "{" + string.Join(",", parts.ToArray()) + "}";
    }
    if (v is System.Collections.IEnumerable) {
      List<string> parts = new List<string>();
      foreach (object o in (System.Collections.IEnumerable)v) parts.Add(Write(o));
      return "[" + string.Join(",", parts.ToArray()) + "]";
    }
    return Q(v.ToString());
  }
  static string Q(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
      else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c);
    }
    return b.Append('"').ToString();
  }
}

public static class Hands {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  // ShowWindowAsync, never ShowWindow: ShowWindow waits for the other app to answer, and a busy app (WhatsApp loading a chat) freezes us
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);

  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  static void SendKey(ushort vk, ushort scan, uint flags) {
    INPUT[] i = new INPUT[1]; i[0].type = 1; i[0].u.ki.wVk = vk; i[0].u.ki.wScan = scan; i[0].u.ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Key(ushort vk, bool up) { SendKey(vk, 0, up ? 2u : 0u); }
  static void Text(string s) { foreach (char c in s) { SendKey(0, c, 4); SendKey(0, c, 4 | 2); Thread.Sleep(8); } }

  static Dictionary<string, object> Ok() { Dictionary<string, object> d = new Dictionary<string, object>(); d["ok"] = true; return d; }
  static Dictionary<string, object> Err(string e) { Dictionary<string, object> d = new Dictionary<string, object>(); d["ok"] = false; d["error"] = e; return d; }
  static string S(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : ""; }
  static int N(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) && v is double ? (int)Math.Round((double)v) : 0; }
  static bool B(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) && v is bool && (bool)v; }

  public static object Run(Dictionary<string, object> a) {
    string op = S(a, "op");
    if (op == "ping") return Ok();
    if (op == "screenshot") return Screenshot();
    if (op == "input") return Input(a);
    if (op == "uia") return Uia();
    if (op == "open-app") return OpenApp(S(a, "app"));
    if (op == "wa-open") return WaOpen(S(a, "to"));
    if (op.StartsWith("phone-")) return Phone(op, S(a, "via") == "whatsapp", S(a, "to"));
    return Err("unknown action " + op);
  }

  // ---- the screen ----
  static object Screenshot() {
    Rectangle b = Screen.PrimaryScreen.Bounds;
    using (Bitmap full = new Bitmap(b.Width, b.Height)) {
      using (Graphics g = Graphics.FromImage(full)) g.CopyFromScreen(b.X, b.Y, 0, 0, full.Size);
      int w = Math.Min(1366, b.Width); int h = (int)Math.Round((double)b.Height * w / b.Width);
      using (Bitmap img = new Bitmap(w, h)) {
        using (Graphics g2 = Graphics.FromImage(img)) { g2.InterpolationMode = InterpolationMode.HighQualityBicubic; g2.DrawImage(full, 0, 0, w, h); }
        ImageCodecInfo enc = null;
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") enc = c;
        EncoderParameters ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
        using (MemoryStream ms = new MemoryStream()) {
          img.Save(ms, enc, ps);
          Dictionary<string, object> d = Ok();
          d["data"] = Convert.ToBase64String(ms.ToArray()); d["w"] = w; d["h"] = h; d["factor"] = (double)b.Width / w;
          return d;
        }
      }
    }
  }

  // ---- mouse and keyboard ----
  static readonly Dictionary<string, ushort> VK = new Dictionary<string, ushort> {
    {"ctrl",0x11},{"control",0x11},{"alt",0x12},{"shift",0x10},{"win",0x5B},{"windows",0x5B},{"cmd",0x5B},{"enter",0x0D},{"return",0x0D},
    {"tab",0x09},{"esc",0x1B},{"escape",0x1B},{"space",0x20},{"backspace",0x08},{"delete",0x2E},{"del",0x2E},{"up",0x26},{"down",0x28},
    {"left",0x25},{"right",0x27},{"home",0x24},{"end",0x23},{"pageup",0x21},{"pagedown",0x22}
  };
  static int VkOf(string k) {
    ushort v; if (VK.TryGetValue(k, out v)) return v;
    Match m = Regex.Match(k, "^f([1-9]|1[0-2])$"); if (m.Success) return 0x6F + int.Parse(m.Groups[1].Value);
    if (k.Length == 1) { char c = char.ToUpperInvariant(k[0]); if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; }
    return -1;
  }
  static object Input(Dictionary<string, object> a) {
    string kind = S(a, "kind");
    if (kind == "click" || kind == "double" || kind == "right") {
      SetCursorPos(N(a, "x"), N(a, "y")); Thread.Sleep(60);
      uint down = kind == "right" ? 0x08u : 0x02u, up = kind == "right" ? 0x10u : 0x04u;
      for (int i = 0; i < (kind == "double" ? 2 : 1); i++) { mouse_event(down, 0, 0, 0, UIntPtr.Zero); mouse_event(up, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(70); }
      return Ok();
    }
    if (kind == "type") { Text(S(a, "text")); if (B(a, "enter")) { Thread.Sleep(80); Key(0x0D, false); Key(0x0D, true); } return Ok(); }
    if (kind == "key") {
      List<ushort> codes = new List<ushort>();
      foreach (string raw in S(a, "keys").ToLowerInvariant().Split('+')) { int c = VkOf(raw.Trim()); if (c < 0) return Err("unknown key " + raw); codes.Add((ushort)c); }
      foreach (ushort c in codes) Key(c, false);
      codes.Reverse(); foreach (ushort c in codes) Key(c, true);
      return Ok();
    }
    if (kind == "scroll") { int d = S(a, "direction") == "down" ? -120 : 120; int n = Math.Max(1, N(a, "amount")); for (int i = 0; i < n; i++) { mouse_event(0x0800, 0, 0, d, UIntPtr.Zero); Thread.Sleep(30); } return Ok(); }
    return Err("unknown input " + kind);
  }

  // ---- windows and apps ----
  static bool Front(Process p) {
    IntPtr h = p.MainWindowHandle; if (h == IntPtr.Zero) return false;
    if (IsIconic(h)) ShowWindowAsync(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); SetForegroundWindow(h); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    Thread.Sleep(150);
    return GetForegroundWindow() == h;
  }
  static Process FindOpen(string q) {
    string w = q.ToLowerInvariant();
    foreach (Process p in Process.GetProcesses()) {
      try { if (p.MainWindowHandle != IntPtr.Zero && ((p.MainWindowTitle ?? "").ToLowerInvariant().Contains(w) || p.ProcessName.ToLowerInvariant().Contains(w))) return p; } catch (Exception) { }
    }
    return null;
  }
  /** The Start menu's apps (name → launch id), through the Shell's AppsFolder. */
  static List<KeyValuePair<string, string>> StartApps() {
    List<KeyValuePair<string, string>> list = new List<KeyValuePair<string, string>>();
    Type t = Type.GetTypeFromProgID("Shell.Application");
    object sh = Activator.CreateInstance(t);
    object folder = t.InvokeMember("NameSpace", BindingFlags.InvokeMethod, null, sh, new object[] { "shell:AppsFolder" });
    object items = folder.GetType().InvokeMember("Items", BindingFlags.InvokeMethod, null, folder, null);
    int count = Convert.ToInt32(items.GetType().InvokeMember("Count", BindingFlags.GetProperty, null, items, null));
    for (int i = 0; i < count; i++) {
      object it = items.GetType().InvokeMember("Item", BindingFlags.InvokeMethod, null, items, new object[] { i });
      if (it == null) continue;
      string name = Convert.ToString(it.GetType().InvokeMember("Name", BindingFlags.GetProperty, null, it, null));
      string path = Convert.ToString(it.GetType().InvokeMember("Path", BindingFlags.GetProperty, null, it, null));
      if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(path)) list.Add(new KeyValuePair<string, string>(name, path));
    }
    return list;
  }
  static object OpenApp(string q) {
    q = (q ?? "").Trim();
    if (q.Length == 0 || q.Length > 80) return Err("Say which app.");
    Process open = FindOpen(q);
    Dictionary<string, object> d;
    if (open != null) { bool f = Front(open); d = Ok(); d["name"] = open.MainWindowTitle; d["already"] = true; d["front"] = f; return d; }
    KeyValuePair<string, string> hit = new KeyValuePair<string, string>(null, null);
    foreach (KeyValuePair<string, string> app in StartApps()) {
      if (string.Equals(app.Key, q, StringComparison.OrdinalIgnoreCase)) { hit = app; break; }
      if (hit.Key == null && app.Key.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) hit = app;
    }
    if (hit.Key == null) return Err("I couldn't find an app called '" + q + "' in the Start menu.");
    Process.Start("explorer.exe", "shell:AppsFolder\\" + hit.Value);
    string first = hit.Key.Split(' ')[0];
    for (int i = 0; i < 20; i++) {
      Thread.Sleep(400);
      Process p = FindOpen(first);
      if (p == null) {
        uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        try { Process fp = Process.GetProcessById((int)pid); if (fp.MainWindowHandle != IntPtr.Zero && fp.StartTime > DateTime.Now.AddSeconds(-15)) p = fp; } catch (Exception) { }
      }
      if (p != null) { bool f = Front(p); d = Ok(); d["name"] = hit.Key; d["front"] = f; return d; }
    }
    d = Ok(); d["name"] = hit.Key; d["front"] = false; return d;
  }

  // ---- calls: Phone Link or WhatsApp Desktop ----
  /** Open the chat with this number in WhatsApp Desktop, maximised and in front (JARVIS then finds the call button on the screen). */
  static object WaOpen(string to) {
    string digits = Regex.Replace(to ?? "", "[^0-9]", "");
    if (digits.Length == 10) digits = "91" + digits;
    if (!Regex.IsMatch(digits, "^[0-9]{10,15}$")) return Err("That number is not dialable.");
    Process.Start("whatsapp://send?phone=" + digits);
    for (int i = 0; i < 20; i++) {
      Thread.Sleep(400);
      Process p = null;
      foreach (string n in new string[] { "WhatsApp", "WhatsApp.Root" }) foreach (Process x in Process.GetProcessesByName(n)) { try { if (x.MainWindowHandle != IntPtr.Zero) p = x; } catch (Exception) { } }
      if (p != null) { ShowWindowAsync(p.MainWindowHandle, 3); Thread.Sleep(300); bool f = Front(p); Dictionary<string, object> d = Ok(); d["front"] = f; return d; }
    }
    return Err("WhatsApp Desktop did not open. Install it from the Microsoft Store and link it to the spare phone's WhatsApp.");
  }

  static bool HasCable() {
    foreach (string kind in new string[] { "Render", "Capture" }) {
      using (RegistryKey root = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\" + kind)) {
        if (root == null) continue;
        foreach (string sub in root.GetSubKeyNames()) {
          using (RegistryKey p = root.OpenSubKey(sub + @"\Properties")) {
            if (p == null) continue;
            foreach (string vn in p.GetValueNames()) { string v = p.GetValue(vn) as string; if (v != null && v.IndexOf("CABLE", StringComparison.OrdinalIgnoreCase) >= 0) return true; }
          }
        }
      }
    }
    return false;
  }
  /** Turn on WebView2's accessibility for this Windows user (WebView2's documented WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
      setting), so apps built on it — like WhatsApp — show Windows their buttons. Nothing else changes. */
  static bool EnsureWebViewAccessibility() {
    const string name = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", flag = "--force-renderer-accessibility";
    string now;
    using (RegistryKey k = Registry.CurrentUser.CreateSubKey("Environment")) {
      string cur = (k.GetValue(name) as string) ?? "";
      if (cur.IndexOf(flag, StringComparison.OrdinalIgnoreCase) >= 0) return false;
      now = (cur + " " + flag).Trim();
      k.SetValue(name, now, RegistryValueKind.String);
    }
    Environment.SetEnvironmentVariable(name, now);
    UIntPtr r; SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Environment", 2, 3000, out r); // tell Windows the environment changed
    return true;
  }

  static object Phone(string op, bool wa, string to) {
    string[] names = wa ? new string[] { "WhatsApp", "WhatsApp.Root" } : new string[] { "PhoneExperienceHost", "YourPhone" };
    bool running = false; foreach (string n in names) if (Process.GetProcessesByName(n).Length > 0) running = true;
    if (op == "phone-check") {
      bool installed = running;
      if (!installed) { try { foreach (KeyValuePair<string, string> app in StartApps()) if (wa ? app.Key.IndexOf("WhatsApp", StringComparison.OrdinalIgnoreCase) >= 0 : (app.Key == "Phone Link" || app.Key == "Your Phone")) installed = true; } catch (Exception) { } }
      Dictionary<string, object> d = Ok(); d["app"] = wa ? "WhatsApp Desktop" : "Phone Link"; d["installed"] = installed; d["running"] = running; d["cable"] = HasCable(); return d;
    }
#if UIA
    Regex endRe = wa ? new Regex("^(end call|end|leave call|hang up)$", RegexOptions.IgnoreCase) : new Regex("^(End call|Hang up|End|Call end)$");
    if (op == "phone-state") { Dictionary<string, object> d = Ok(); d["inCall"] = InCallNamed(names, wa) || InCall(names, endRe); return d; }
    if (op == "phone-hangup") {
      List<AutomationElement> ws = Windows(names);
      Dictionary<string, object> d = Ok(); d["pressed"] = PressNamed(ws, wa ? new string[] { "End call", "Leave call", "Hang up", "End" } : new string[] { "End call", "Hang up", "End", "Call end" }) || Press(ws, endRe); return d;
    }
    if (op == "phone-dial") {
      string digits = Regex.Replace(to ?? "", "[^0-9]", "");
      if (wa) {
        if (digits.Length == 10) digits = "91" + digits;
        if (!Regex.IsMatch(digits, "^[0-9]{10,15}$")) return Err("That number is not dialable.");
      } else if (!Regex.IsMatch(to ?? "", "^\\+?[0-9]{8,15}$")) return Err("That number is not dialable.");
      if (InCallNamed(names, wa)) return Err((wa ? "WhatsApp" : "Phone Link") + " is already on a call.");
      Process.Start(wa ? "whatsapp://send?phone=" + digits : "tel:" + to);
      Regex callRe = wa ? new Regex("^(voice call|audio call)", RegexOptions.IgnoreCase) : new Regex("^(Call|Start call|Dial)$");
      Regex confirmRe = new Regex("^(call|start call|start voice call)$", RegexOptions.IgnoreCase);
      string[] callNames = wa ? new string[] { "Voice call", "Audio call", "Start voice call" } : new string[] { "Call", "Start call", "Dial" };
      string[] confirmNames = { "Call", "Start call", "Start voice call" };
      bool pressed = false, retried = false;
      Stopwatch sw = Stopwatch.StartNew();
      int round = 0;
      while (sw.ElapsedMilliseconds < 60000) {
        Thread.Sleep(600); round++;
        // WhatsApp (a web page in WebView2) shows Windows only its title-bar buttons until accessibility is on:
        // switch WebView2's own accessibility flag on for this user, restart WhatsApp once, and look again
        if (wa && !pressed && !retried && round == 6 && OnlyTitleButtons(names)) {
          retried = true;
          EnsureWebViewAccessibility();
          foreach (string n in names) foreach (Process p in Process.GetProcessesByName(n)) { try { p.Kill(); } catch (Exception) { } }
          Thread.Sleep(2000);
          Process.Start("whatsapp://send?phone=" + digits);
          Thread.Sleep(4000);
          continue;
        }
        if (pressed && InCall(names, endRe)) { Dictionary<string, object> d = Ok(); d["pressed"] = true; return d; }
        List<AutomationElement> ws = Windows(names);
        // ask for the button by its name (fast); the full scan only now and then
        if (!pressed) pressed = PressNamed(ws, callNames) || (round % 4 == 0 && Press(ws, callRe));
        else if (wa) { if (!PressNamed(ws, confirmNames) && round % 4 == 0) Press(ws, confirmRe); }
        if (pressed && round > 2 && InCallNamed(names, wa)) { Dictionary<string, object> d = Ok(); d["pressed"] = true; return d; }
      }
      if (Windows(names).Count == 0) return Err(wa ? "WhatsApp Desktop did not open. Install it from the Microsoft Store and link it to the spare phone's WhatsApp." : "Phone Link did not open. Open Phone Link, make sure your phone is connected and Calls are set up.");
      if (!pressed) return Err((wa ? "WhatsApp opened the chat but I couldn't find its voice-call button - is this number on WhatsApp?" : "Phone Link opened but the call didn't start. Check that Calls is set up in Phone Link (Bluetooth paired).") + " Buttons I can see: " + ButtonNames(names));
      return Err("I pressed the call button but the call didn't start. Buttons I can see now: " + ButtonNames(names));
    }
    return Err("Unknown phone action.");
#else
    return Err("This build can't press call buttons (UI Automation wasn't available when JARVIS built its hands).");
#endif
  }

#if UIA
  static List<AutomationElement> Windows(string[] names) {
    HashSet<int> ids = new HashSet<int>();
    foreach (string n in names) foreach (Process p in Process.GetProcessesByName(n)) ids.Add(p.Id);
    List<AutomationElement> list = new List<AutomationElement>();
    if (ids.Count == 0) return list;
    foreach (AutomationElement w in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition)) {
      try { if (ids.Contains(w.Current.ProcessId)) list.Add(w); } catch (Exception) { }
    }
    return list;
  }
  static List<AutomationElement> Buttons(List<AutomationElement> ws) {
    List<AutomationElement> list = new List<AutomationElement>();
    PropertyCondition c = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
    foreach (AutomationElement w in ws) { try { foreach (AutomationElement b in w.FindAll(TreeScope.Descendants, c)) list.Add(b); } catch (Exception) { } }
    return list;
  }
  static bool Press(List<AutomationElement> ws, Regex re) {
    foreach (AutomationElement b in Buttons(ws)) {
      try {
        if (re.IsMatch(b.Current.Name ?? "") && b.Current.IsEnabled) { ((InvokePattern)b.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); return true; }
      } catch (Exception) { }
    }
    return false;
  }
  static bool OnlyTitleButtons(string[] names) {
    foreach (AutomationElement b in Buttons(Windows(names))) {
      try { string n = (b.Current.Name ?? "").Trim(); if (n != "" && n != "Minimize" && n != "Maximize" && n != "Restore" && n != "Close") return false; } catch (Exception) { }
    }
    return true;
  }
  /** The names of the buttons in the app's windows (to see what it calls things). */
  static string ButtonNames(string[] names) {
    List<string> seen = new List<string>();
    foreach (AutomationElement b in Buttons(Windows(names))) {
      try { string n = (b.Current.Name ?? "").Trim(); if (n.Length > 0 && n.Length < 60 && !seen.Contains(n)) seen.Add(n); } catch (Exception) { }
      if (seen.Count >= 45) break;
    }
    return seen.Count > 0 ? string.Join(" | ", seen.ToArray()) : "(none - Windows can't read this app's buttons)";
  }
  static Condition NamedButtons(string[] labels) {
    Condition[] byName = new Condition[labels.Length];
    for (int i = 0; i < labels.Length; i++) byName[i] = new PropertyCondition(AutomationElement.NameProperty, labels[i], PropertyConditionFlags.IgnoreCase);
    Condition names = labels.Length == 1 ? byName[0] : new OrCondition(byName);
    return new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button), names);
  }
  /** Press the first button with one of these names (asked of Windows directly — fast). */
  static bool PressNamed(List<AutomationElement> ws, string[] labels) {
    Condition c = NamedButtons(labels);
    foreach (AutomationElement w in ws) {
      try {
        AutomationElement b = w.FindFirst(TreeScope.Descendants, c);
        if (b != null && b.Current.IsEnabled) { ((InvokePattern)b.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); return true; }
      } catch (Exception) { }
    }
    return false;
  }
  static bool InCallNamed(string[] names, bool wa) {
    Condition c = NamedButtons(wa ? new string[] { "End call", "Leave call", "Hang up", "End" } : new string[] { "End call", "Hang up", "End", "Call end" });
    foreach (AutomationElement w in Windows(names)) { try { if (w.FindFirst(TreeScope.Descendants, c) != null) return true; } catch (Exception) { } }
    return false;
  }
  static bool InCall(string[] names, Regex endRe) {
    foreach (AutomationElement b in Buttons(Windows(names))) { try { if (endRe.IsMatch(b.Current.Name ?? "")) return true; } catch (Exception) { } }
    return false;
  }
  /** The clickable things in the window in front (names, kinds, where they are). */
  static object Uia() {
    List<object> outl = new List<object>();
    try {
      AutomationElement f = AutomationElement.FocusedElement; TreeWalker walker = TreeWalker.ControlViewWalker; AutomationElement top = f;
      while (top != null) { AutomationElement p = walker.GetParent(top); if (p == null || p.Equals(AutomationElement.RootElement)) break; top = p; }
      ControlType[] types = { ControlType.Button, ControlType.Edit, ControlType.Hyperlink, ControlType.MenuItem, ControlType.ListItem, ControlType.TabItem, ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox, ControlType.TreeItem, ControlType.SplitButton, ControlType.Document };
      Condition[] conds = new Condition[types.Length];
      for (int i = 0; i < types.Length; i++) conds[i] = new PropertyCondition(AutomationElement.ControlTypeProperty, types[i]);
      foreach (AutomationElement e in top.FindAll(TreeScope.Descendants, new OrCondition(conds))) {
        if (outl.Count >= 150) break;
        try {
          AutomationElement.AutomationElementInformation c = e.Current;
          if (c.IsOffscreen) continue;
          System.Windows.Rect r = c.BoundingRectangle;
          if (r.IsEmpty || r.Width < 3 || r.Height < 3) continue;
          string name = c.Name; if (string.IsNullOrEmpty(name)) name = c.HelpText;
          if (string.IsNullOrEmpty(name) && c.ControlType != ControlType.Edit) continue;
          Dictionary<string, object> d = new Dictionary<string, object>();
          d["name"] = (name ?? "").Length > 120 ? name.Substring(0, 120) : (name ?? "");
          d["role"] = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
          d["x"] = (int)r.X; d["y"] = (int)r.Y; d["w"] = (int)r.Width; d["h"] = (int)r.Height; d["password"] = c.IsPassword;
          outl.Add(d);
        } catch (Exception) { }
      }
    } catch (Exception) { }
    return outl;
  }
#else
  static object Uia() { return new List<object>(); }
#endif
}

public static class Program {
  [STAThread]
  public static void Main() { JvOverlay.Run(); }
}

# JARVIS - "JARVIS is working" on the screen, while JARVIS controls the laptop.
# A glowing frame around the screen (clicks pass through it), a bar at the bottom saying what JARVIS
# is doing with a Stop button, a ripple wherever it clicks, and Yes / No questions before risky steps.
# Everything fades in and out. Stop also works with Ctrl+Alt+Backspace from anywhere.
# Commands arrive on stdin, one per line, tab separated (fixed commands; text is only ever shown):
#   show<TAB>text | hide | ripple<TAB>x<TAB>y | ask<TAB>id<TAB>question<TAB>detail | shot<TAB>id | exit
# Events go to stdout: ready | stop | answer<TAB>id<TAB>yes|no | shot<TAB>id<TAB>w<TAB>h<TAB>factor<TAB>base64-jpeg | shoterr<TAB>id<TAB>why
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$src = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

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

  static void Read() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string[] p = line.Split('\t');
      string cmd = p[0];
      if (cmd == "exit") break;
      if (cmd == "shot") { Shot(p.Length > 1 ? p[1] : "s"); continue; }
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
"@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms, System.Drawing
[JvOverlay]::Run()

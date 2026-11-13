// Fraction Chess — лаунчер для Windows.
// Игра (HTML/JS/CSS/3D-модели) вшита в .exe как ресурсы. При запуске файлы распаковываются
// в %LOCALAPPDATA%\FractionChess\app, поднимается локальный HTTP-сервер (только localhost —
// браузер не загружает 3D-модели и JS-модули с file://), и игра открывается в отдельном окне
// Microsoft Edge (режим приложения). Сервер работает, пока открыто окно игры.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Fraction Chess")]
[assembly: AssemblyProduct("Fraction Chess")]
[assembly: AssemblyVersion("0.3.0.0")]

static class Launcher
{
    const string Prefix = "app/";
    static string appDir;
    static readonly Dictionary<string, string> Mime = new Dictionary<string, string> {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".md", "text/plain; charset=utf-8" },
        { ".glb", "model/gltf-binary" }, { ".json", "application/json" }, { ".png", "image/png" }
    };

    [STAThread]
    static void Main()
    {
        try
        {
            string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FractionChess");
            appDir = Path.Combine(baseDir, "app");
            if (Directory.Exists(appDir)) Directory.Delete(appDir, true); // убрать файлы старой версии
            Extract(appDir);

            HttpListener http = null; int port = 0;
            for (int p = 17853; p < 17900 && http == null; p++)
            {
                try { var l = new HttpListener(); l.Prefixes.Add("http://localhost:" + p + "/"); l.Start(); http = l; port = p; }
                catch (HttpListenerException) { }
            }
            if (http == null) throw new Exception("Не удалось открыть локальный порт для игры (17853–17899 заняты).");
            var server = new Thread(() => Serve(http)) { IsBackground = true };
            server.Start();

            string page = File.Exists(Path.Combine(appDir, "index-gl.html")) ? "index-gl.html" : "index3d.html";
            string url = "http://localhost:" + port + "/" + page;
            string edge = FindEdge();
            if (edge != null)
            {
                string profile = Path.Combine(baseDir, "profile");
                var psi = new ProcessStartInfo(edge,
                    "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --window-size=1500,950 --no-first-run --no-default-browser-check");
                psi.UseShellExecute = false;
                Process.Start(psi);
                // держим сервер, пока окно игры открыто (Edge держит lockfile в своём профиле)
                string lockFile = Path.Combine(profile, "lockfile");
                for (int i = 0; i < 60 && !File.Exists(lockFile); i++) Thread.Sleep(500);
                while (File.Exists(lockFile) && IsLocked(lockFile)) Thread.Sleep(2000);
            }
            else
            {
                Process.Start(url); // браузер по умолчанию
                MessageBox.Show("Игра открыта в браузере.\nНе закрывайте это окно, пока играете — нажмите «ОК», чтобы завершить.",
                    "Fraction Chess", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            http.Stop();
        }
        catch (Exception e)
        {
            MessageBox.Show("Не удалось запустить игру:\n" + e.Message, "Fraction Chess", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static bool IsLocked(string path)
    {
        try { using (File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } return false; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    static void Serve(HttpListener http)
    {
        string root = Path.GetFullPath(appDir) + Path.DirectorySeparatorChar;
        while (http.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = http.GetContext(); } catch { return; }
            try
            {
                string rel = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath.TrimStart('/'));
                if (rel == "") rel = "index-gl.html";
                string file = Path.GetFullPath(Path.Combine(appDir, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!file.StartsWith(root) || !File.Exists(file)) { ctx.Response.StatusCode = 404; }
                else
                {
                    string ct;
                    if (Mime.TryGetValue(Path.GetExtension(file).ToLowerInvariant(), out ct)) ctx.Response.ContentType = ct;
                    ctx.Response.AddHeader("Cache-Control", "no-store");
                    byte[] bytes = File.ReadAllBytes(file);
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
            }
            catch { }
            finally { try { ctx.Response.Close(); } catch { } }
        }
    }

    static void Extract(string dir)
    {
        var asm = Assembly.GetExecutingAssembly();
        foreach (string name in asm.GetManifestResourceNames())
        {
            if (!name.StartsWith(Prefix)) continue;
            string rel = name.Substring(Prefix.Length).Replace('/', Path.DirectorySeparatorChar);
            string target = Path.Combine(dir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (Stream s = asm.GetManifestResourceStream(name))
            using (FileStream f = File.Create(target))
                s.CopyTo(f);
        }
    }

    static string FindEdge()
    {
        string[] roots = {
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        foreach (string r in roots)
        {
            if (string.IsNullOrEmpty(r)) continue;
            string p = Path.Combine(r, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }
}

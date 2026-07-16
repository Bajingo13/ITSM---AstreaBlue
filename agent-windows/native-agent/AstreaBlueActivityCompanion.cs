using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AstreaBlue.ActivityCompanion
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
        [DllImport("user32.dll")] internal static extern bool GetLastInputInfo(ref LastInputInfo info);

        [StructLayout(LayoutKind.Sequential)]
        internal struct LastInputInfo { internal uint cbSize; internal uint dwTime; }
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly string LogDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AstreaBlue", "MonitoringAgent", "logs");
        private static readonly string ScreenshotSpoolDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AstreaBlue", "MonitoringAgent", "screenshot-spool");
        private static DateTime lastScreenshotUtc = DateTime.MinValue;

        private static void Log(string level, string message)
        {
            try
            {
                Directory.CreateDirectory(LogDirectory);
                string path = Path.Combine(LogDirectory, "companion-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".log");
                File.AppendAllText(path, String.Format("[{0}] [{1}] {2}{3}", DateTime.UtcNow.ToString("o"), level, message, Environment.NewLine));
            }
            catch { }
        }

        private static Dictionary<string, object> ReadActivity()
        {
            IntPtr window = NativeMethods.GetForegroundWindow();
            StringBuilder title = new StringBuilder(512);
            NativeMethods.GetWindowText(window, title, title.Capacity);
            uint processId;
            NativeMethods.GetWindowThreadProcessId(window, out processId);
            string processName = "Unknown";
            try { processName = Process.GetProcessById((int)processId).ProcessName; } catch { }
            NativeMethods.LastInputInfo input = new NativeMethods.LastInputInfo();
            input.cbSize = (uint)Marshal.SizeOf(input);
            NativeMethods.GetLastInputInfo(ref input);
            uint elapsed = unchecked((uint)Environment.TickCount - input.dwTime);
            Dictionary<string, object> activity = new Dictionary<string, object>();
            activity["app_name"] = processName;
            activity["window_title"] = title.ToString();
            activity["idle_seconds"] = Math.Max(0, elapsed / 1000);
            return activity;
        }

        private static Dictionary<string, object> ExchangeMessage(Dictionary<string, object> message)
        {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", "AstreaBlueActivityV1", PipeDirection.InOut))
            {
                pipe.Connect(5000);
                using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true))
                {
                    writer.WriteLine(Json.Serialize(message));
                    writer.Flush();
                }
                using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true))
                {
                    string response = reader.ReadLine();
                    return String.IsNullOrWhiteSpace(response)
                        ? new Dictionary<string, object>()
                        : Json.Deserialize<Dictionary<string, object>>(response);
                }
            }
        }

        private static bool BooleanValue(Dictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) && Convert.ToBoolean(value);
        }

        private static int IntegerValue(Dictionary<string, object> source, string key, int fallback)
        {
            object value;
            int parsed;
            return source != null && source.TryGetValue(key, out value) && Int32.TryParse(Convert.ToString(value), out parsed)
                ? parsed
                : fallback;
        }

        private static bool IsLockedScreen(Dictionary<string, object> activity)
        {
            string app = Convert.ToString(activity["app_name"]);
            return String.Equals(app, "LockApp", StringComparison.OrdinalIgnoreCase)
                || String.Equals(app, "LogonUI", StringComparison.OrdinalIgnoreCase);
        }

        private static void NotifyCapture()
        {
            using (NotifyIcon notification = new NotifyIcon())
            {
                notification.Icon = SystemIcons.Information;
                notification.Visible = true;
                notification.BalloonTipTitle = "AstreaBlue endpoint monitoring";
                notification.BalloonTipText = "A consent-approved screenshot is being captured for company security monitoring.";
                notification.ShowBalloonTip(3000);
                Thread.Sleep(2000);
                notification.Visible = false;
            }
        }

        private static string CaptureScreenshot()
        {
            Directory.CreateDirectory(ScreenshotSpoolDirectory);
            string file = Path.Combine(ScreenshotSpoolDirectory, "capture-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N") + ".jpg");
            Rectangle bounds = SystemInformation.VirtualScreen;
            using (Bitmap image = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            using (Graphics graphics = Graphics.FromImage(image))
            {
                graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                ImageCodecInfo jpeg = Array.Find(ImageCodecInfo.GetImageEncoders(), codec => codec.FormatID == ImageFormat.Jpeg.Guid);
                using (EncoderParameters parameters = new EncoderParameters(1))
                {
                    parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 75L);
                    image.Save(file, jpeg, parameters);
                }
            }
            return file;
        }

        private static void DeliverScreenshot(string file)
        {
            Dictionary<string, object> message = new Dictionary<string, object>();
            message["message_type"] = "screenshot";
            message["file_path"] = file;
            message["captured_at"] = File.GetCreationTimeUtc(file).ToString("o");
            message["reason"] = "Consent-approved periodic capture";
            Dictionary<string, object> response = ExchangeMessage(message);
            if (!BooleanValue(response, "accepted")) throw new InvalidOperationException("The monitoring service did not accept the screenshot.");
            File.Delete(file);
            Log("INFO", "Screenshot securely handed to the monitoring service.");
        }

        private static void DeliverPendingScreenshots()
        {
            if (!Directory.Exists(ScreenshotSpoolDirectory)) return;
            foreach (string file in Directory.GetFiles(ScreenshotSpoolDirectory, "capture-*.jpg"))
            {
                if (File.GetCreationTimeUtc(file) < DateTime.UtcNow.AddHours(-24)) { File.Delete(file); continue; }
                DeliverScreenshot(file);
            }
        }

        private static int Main()
        {
            string mutexName = "Local\\AstreaBlueActivityCompanion." + Process.GetCurrentProcess().SessionId;
            bool created;
            using (Mutex mutex = new Mutex(true, mutexName, out created))
            {
                if (!created) return 0;
                Log("INFO", "Activity companion started in Windows session " + Process.GetCurrentProcess().SessionId + ".");
                bool firstDelivery = true;
                string previousError = null;
                while (true)
                {
                    try
                    {
                        DeliverPendingScreenshots();
                        Dictionary<string, object> activity = ReadActivity();
                        activity["message_type"] = "activity";
                        Dictionary<string, object> directive = ExchangeMessage(activity);
                        if (firstDelivery || previousError != null) Log("INFO", "Activity sample delivered to the monitoring service.");
                        firstDelivery = false;
                        previousError = null;

                        int intervalMinutes = Math.Max(1, IntegerValue(directive, "screenshot_interval_minutes", 15));
                        if (BooleanValue(directive, "screenshot_enabled")
                            && !IsLockedScreen(activity)
                            && DateTime.UtcNow - lastScreenshotUtc >= TimeSpan.FromMinutes(intervalMinutes))
                        {
                            NotifyCapture();
                            string screenshot = CaptureScreenshot();
                            lastScreenshotUtc = DateTime.UtcNow;
                            DeliverScreenshot(screenshot);
                        }
                    }
                    catch (Exception error)
                    {
                        if (!String.Equals(previousError, error.Message, StringComparison.Ordinal))
                            Log("ERROR", "Activity sample delivery failed: " + error.Message);
                        previousError = error.Message;
                    }
                    Thread.Sleep(TimeSpan.FromSeconds(30));
                }
            }
        }
    }
}

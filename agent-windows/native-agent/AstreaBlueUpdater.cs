using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

namespace AstreaBlue.Updater
{
    internal static class Program
    {
        private const string ServiceName = "AstreaBlueMonitoringAgent";

        private static void WaitForService(ServiceController service, ServiceControllerStatus status, TimeSpan timeout)
        {
            service.WaitForStatus(status, timeout);
            service.Refresh();
            if (service.Status != status) throw new InvalidOperationException("Service did not reach " + status + ".");
        }

        private static int Main(string[] args)
        {
            if (args.Length != 4) return 2;
            string stagedService = Path.GetFullPath(args[0]);
            string stagedCompanion = Path.GetFullPath(args[1]);
            string installDirectory = Path.GetFullPath(args[2]);
            string expectedVersion = args[3];
            string targetService = Path.Combine(installDirectory, "AstreaBlue.Agent.Service.exe");
            string targetCompanion = Path.Combine(installDirectory, "AstreaBlue.ActivityCompanion.exe");
            string serviceBackup = targetService + ".rollback";
            string companionBackup = targetCompanion + ".rollback";

            if (!File.Exists(stagedService) || !File.Exists(stagedCompanion) || !Directory.Exists(installDirectory)) return 3;
            try
            {
                using (ServiceController service = new ServiceController(ServiceName))
                {
                    service.Refresh();
                    if (service.Status != ServiceControllerStatus.Stopped)
                    {
                        service.Stop();
                        WaitForService(service, ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60));
                    }
                    foreach (Process process in Process.GetProcessesByName("AstreaBlue.ActivityCompanion")) try { process.Kill(); } catch { }
                    File.Copy(targetService, serviceBackup, true);
                    if (File.Exists(targetCompanion)) File.Copy(targetCompanion, companionBackup, true);
                    File.Copy(stagedService, targetService, true);
                    File.Copy(stagedCompanion, targetCompanion, true);

                    ProcessStartInfo versionCheck = new ProcessStartInfo(targetService, "--version");
                    versionCheck.UseShellExecute = false;
                    versionCheck.CreateNoWindow = true;
                    versionCheck.RedirectStandardOutput = true;
                    using (Process check = Process.Start(versionCheck))
                    {
                        string version = check.StandardOutput.ReadToEnd().Trim();
                        check.WaitForExit(15000);
                        if (check.ExitCode != 0 || !String.Equals(version, expectedVersion, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Updated executable version validation failed.");
                    }
                    service.Start();
                    WaitForService(service, ServiceControllerStatus.Running, TimeSpan.FromSeconds(60));
                    File.Delete(serviceBackup);
                    if (File.Exists(companionBackup)) File.Delete(companionBackup);
                    return 0;
                }
            }
            catch
            {
                try
                {
                    if (File.Exists(serviceBackup)) File.Copy(serviceBackup, targetService, true);
                    if (File.Exists(companionBackup)) File.Copy(companionBackup, targetCompanion, true);
                    using (ServiceController service = new ServiceController(ServiceName))
                    {
                        service.Refresh();
                        if (service.Status == ServiceControllerStatus.Stopped) service.Start();
                    }
                }
                catch { }
                return 1;
            }
        }
    }
}

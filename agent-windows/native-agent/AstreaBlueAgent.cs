using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Management;
using Microsoft.Win32;
using System.Net;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Security.Cryptography.X509Certificates;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace AstreaBlue.Agent
{
    internal static class AgentPaths
    {
        private static readonly string ConfiguredRoot = Environment.GetEnvironmentVariable("ASTREABLUE_AGENT_DATA_DIR");
        private static string ResolveRoot()
        {
            return String.IsNullOrWhiteSpace(ConfiguredRoot)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AstreaBlue", "MonitoringAgent")
                : Path.GetFullPath(ConfiguredRoot);
        }

        internal static readonly string Root = ResolveRoot();
        internal static readonly string Config = Path.Combine(Root, "config.json");
        internal static readonly string Identity = Path.Combine(Root, "device.json");
        internal static readonly string LegacyIdentity = String.IsNullOrWhiteSpace(ConfiguredRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AstreaBlue", "device.json")
            : Path.Combine(Root, "legacy-device.json");
        internal static readonly string Credential = Path.Combine(Root, "credential.bin");
        internal static readonly string Policy = Path.Combine(Root, "policy.json");
        internal static readonly string Logs = Path.Combine(Root, "logs");
    }

    internal sealed class AgentConfig
    {
        public string BackendUrl { get; set; }
        public string DeviceName { get; set; }
        public int HeartbeatSeconds { get; set; }
        public string UpdateManifestUrl { get; set; }
        public string UpdateChannel { get; set; }
        public string TrustedSignerThumbprint { get; set; }
    }

    internal sealed class DeviceIdentity
    {
        public string device_uuid { get; set; }
        public string hostname { get; set; }
        public string created_at { get; set; }
    }

    internal sealed class EffectivePolicy
    {
        public string policy_version { get; set; }
        public bool heartbeat_enabled { get; set; }
        public bool policy_sync_enabled { get; set; }
        public bool hardware_inventory_enabled { get; set; }
        public bool software_inventory_enabled { get; set; }
        public bool activity_monitoring_enabled { get; set; }
    }

    internal sealed class UpdateManifest
    {
        public string version { get; set; }
        public string channel { get; set; }
        public string service_download_url { get; set; }
        public string service_sha256 { get; set; }
        public string companion_download_url { get; set; }
        public string companion_sha256 { get; set; }
    }

    internal static class AgentRuntime
    {
        internal const string Version = "native-1.1.0";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AstreaBlue.Endpoint.DeviceCredential.v1");

        internal static void EnsureDirectories()
        {
            Directory.CreateDirectory(AgentPaths.Root);
            Directory.CreateDirectory(AgentPaths.Logs);
        }

        internal static void Log(string level, string message)
        {
            EnsureDirectories();
            string line = String.Format("[{0}] [{1}] {2}{3}", DateTime.UtcNow.ToString("o"), level, message, Environment.NewLine);
            try { File.AppendAllText(Path.Combine(AgentPaths.Logs, "agent-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".log"), line); }
            catch { }
            if (Environment.UserInteractive) Console.Write(line);
        }

        internal static AgentConfig LoadConfig()
        {
            if (!File.Exists(AgentPaths.Config)) throw new InvalidOperationException("Agent configuration is missing. Run native-install.ps1.");
            AgentConfig config = Json.Deserialize<AgentConfig>(File.ReadAllText(AgentPaths.Config));
            if (config == null || String.IsNullOrWhiteSpace(config.BackendUrl)) throw new InvalidOperationException("BackendUrl is missing from agent configuration.");
            config.BackendUrl = config.BackendUrl.TrimEnd('/');
            if (config.HeartbeatSeconds < 30) config.HeartbeatSeconds = 30;
            return config;
        }

        internal static void SaveConfig(AgentConfig config)
        {
            EnsureDirectories();
            File.WriteAllText(AgentPaths.Config, Json.Serialize(config), Encoding.UTF8);
        }

        internal static DeviceIdentity LoadOrCreateIdentity()
        {
            EnsureDirectories();
            if (!File.Exists(AgentPaths.Identity) && File.Exists(AgentPaths.LegacyIdentity))
            {
                DeviceIdentity legacy = Json.Deserialize<DeviceIdentity>(File.ReadAllText(AgentPaths.LegacyIdentity));
                Guid legacyId;
                if (legacy != null && Guid.TryParse(legacy.device_uuid, out legacyId))
                {
                    File.Copy(AgentPaths.LegacyIdentity, AgentPaths.Identity, false);
                    Log("INFO", "Preserved the existing pilot device identity during native-agent migration.");
                }
            }
            if (File.Exists(AgentPaths.Identity))
            {
                DeviceIdentity existing = Json.Deserialize<DeviceIdentity>(File.ReadAllText(AgentPaths.Identity));
                Guid parsed;
                if (existing != null && Guid.TryParse(existing.device_uuid, out parsed)) return existing;
                throw new InvalidOperationException("Existing device identity is invalid. Do not delete it unless this laptop is intentionally re-enrolled as a new device.");
            }
            DeviceIdentity identity = new DeviceIdentity
            {
                device_uuid = Guid.NewGuid().ToString(),
                hostname = Environment.MachineName,
                created_at = DateTime.UtcNow.ToString("o")
            };
            using (FileStream stream = new FileStream(AgentPaths.Identity, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            using (StreamWriter writer = new StreamWriter(stream, Encoding.UTF8)) writer.Write(Json.Serialize(identity));
            return identity;
        }

        internal static void SaveCredential(string credential)
        {
            if (String.IsNullOrWhiteSpace(credential) || !credential.StartsWith("ABDEV-", StringComparison.Ordinal)) throw new InvalidOperationException("The backend returned an invalid device credential.");
            EnsureDirectories();
            byte[] plain = Encoding.UTF8.GetBytes(credential);
            byte[] protectedValue = ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine);
            File.WriteAllBytes(AgentPaths.Credential, protectedValue);
            Array.Clear(plain, 0, plain.Length);
        }

        internal static string LoadCredential()
        {
            if (!File.Exists(AgentPaths.Credential)) throw new InvalidOperationException("Protected device credential is missing. Re-enroll this laptop.");
            byte[] protectedValue = File.ReadAllBytes(AgentPaths.Credential);
            byte[] plain = ProtectedData.Unprotect(protectedValue, Entropy, DataProtectionScope.LocalMachine);
            try { return Encoding.UTF8.GetString(plain); }
            finally { Array.Clear(plain, 0, plain.Length); }
        }

        internal static void Enroll(string backendUrl, string enrollmentCode, string deviceName)
        {
            if (String.IsNullOrWhiteSpace(backendUrl) || String.IsNullOrWhiteSpace(enrollmentCode)) throw new ArgumentException("Backend URL and enrollment code are required.");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            DeviceIdentity identity = LoadOrCreateIdentity();
            AgentConfig config = new AgentConfig { BackendUrl = backendUrl.TrimEnd('/'), DeviceName = String.IsNullOrWhiteSpace(deviceName) ? Environment.MachineName : deviceName, HeartbeatSeconds = 30, UpdateChannel = "stable" };
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["enrollment_code"] = enrollmentCode;
            body["device_uuid"] = identity.device_uuid;
            body["hostname"] = Environment.MachineName;
            body["device_name"] = config.DeviceName;
            body["agent_version"] = Version;
            Dictionary<string, object> response = SendJson(config.BackendUrl + "/api/v1/laptop-monitoring/enroll", body, null);
            Dictionary<string, object> data = GetDictionary(response, "data");
            object credentialValue;
            if (data == null || !data.TryGetValue("device_credential", out credentialValue)) throw new InvalidOperationException("Enrollment succeeded without a device credential.");
            SaveCredential(Convert.ToString(credentialValue));
            SaveConfig(config);
            Log("INFO", "Enrollment successful for device " + identity.device_uuid + ".");
        }

        internal static void Heartbeat()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            AgentConfig config = LoadConfig();
            DeviceIdentity identity = LoadOrCreateIdentity();
            string credential = LoadCredential();
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["device_uuid"] = identity.device_uuid;
            body["hostname"] = Environment.MachineName;
            body["device_name"] = String.IsNullOrWhiteSpace(config.DeviceName) ? Environment.MachineName : config.DeviceName;
            body["agent_version"] = Version;
            body["logged_in_user"] = ActiveUser();
            body["timestamp"] = DateTime.UtcNow.ToString("o");
            SendJson(config.BackendUrl + "/api/v1/laptop-monitoring/heartbeat", body, credential);
            Log("INFO", "Heartbeat successful for " + identity.device_uuid + ".");
        }

        internal static EffectivePolicy LoadPolicy()
        {
            EffectivePolicy fallback = new EffectivePolicy
            {
                policy_version = "local-default",
                heartbeat_enabled = true,
                policy_sync_enabled = true,
                hardware_inventory_enabled = true,
                software_inventory_enabled = true,
                activity_monitoring_enabled = false
            };
            try
            {
                if (!File.Exists(AgentPaths.Policy)) return fallback;
                EffectivePolicy saved = Json.Deserialize<EffectivePolicy>(File.ReadAllText(AgentPaths.Policy));
                return saved ?? fallback;
            }
            catch (Exception error)
            {
                Log("WARN", "Cached policy could not be loaded: " + error.Message);
                return fallback;
            }
        }

        internal static EffectivePolicy SyncPolicy()
        {
            AgentConfig config = LoadConfig();
            DeviceIdentity identity = LoadOrCreateIdentity();
            Dictionary<string, object> response = SendGetJson(
                config.BackendUrl + "/api/v1/laptop-monitoring/policy/latest?device_uuid=" + Uri.EscapeDataString(identity.device_uuid),
                LoadCredential());
            Dictionary<string, object> data = GetDictionary(response, "data");
            if (data == null) throw new InvalidOperationException("The backend returned no effective policy.");
            EffectivePolicy policy = Json.Deserialize<EffectivePolicy>(Json.Serialize(data));
            File.WriteAllText(AgentPaths.Policy, Json.Serialize(policy), Encoding.UTF8);
            Log("INFO", "Policy synchronized. Version=" + (policy.policy_version ?? "unknown") + ".");
            return policy;
        }

        internal static void SendHardwareInventory()
        {
            if (!LoadPolicy().hardware_inventory_enabled) { Log("INFO", "Hardware inventory skipped by effective policy."); return; }
            AgentConfig config = LoadConfig();
            DeviceIdentity identity = LoadOrCreateIdentity();
            Dictionary<string, object> computer = WmiFirst("SELECT Manufacturer,Model,TotalPhysicalMemory FROM Win32_ComputerSystem");
            Dictionary<string, object> bios = WmiFirst("SELECT SerialNumber FROM Win32_BIOS");
            Dictionary<string, object> cpu = WmiFirst("SELECT Name FROM Win32_Processor");
            Dictionary<string, object> operatingSystem = WmiFirst("SELECT Caption,Version,BuildNumber,OSArchitecture FROM Win32_OperatingSystem");
            Dictionary<string, object> disk = WmiFirst("SELECT Size,FreeSpace FROM Win32_LogicalDisk WHERE DeviceID='C:'");
            Dictionary<string, object> network = WmiFirst("SELECT MACAddress,IPAddress FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=TRUE");
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["device_uuid"] = identity.device_uuid;
            body["manufacturer"] = Value(computer, "Manufacturer");
            body["model"] = Value(computer, "Model");
            body["serial_number"] = Value(bios, "SerialNumber");
            body["cpu_name"] = Value(cpu, "Name");
            body["total_ram_gb"] = BytesToGb(Value(computer, "TotalPhysicalMemory"));
            body["os_name"] = Value(operatingSystem, "Caption");
            body["os_version"] = Value(operatingSystem, "Version");
            body["os_build"] = Value(operatingSystem, "BuildNumber");
            body["architecture"] = Value(operatingSystem, "OSArchitecture");
            body["disk_total_gb"] = BytesToGb(Value(disk, "Size"));
            body["disk_free_gb"] = BytesToGb(Value(disk, "FreeSpace"));
            body["mac_address"] = Value(network, "MACAddress");
            body["ip_address"] = FirstArrayValue(network, "IPAddress");
            body["scanned_at"] = DateTime.UtcNow.ToString("o");
            SendJson(config.BackendUrl + "/api/v1/laptop-monitoring/hardware-inventory", body, LoadCredential());
            Log("INFO", "Hardware inventory synchronized.");
        }

        internal static void SendSoftwareInventory()
        {
            if (!LoadPolicy().software_inventory_enabled) { Log("INFO", "Software inventory skipped by effective policy."); return; }
            DateTime started = DateTime.UtcNow;
            List<object> software = new List<object>();
            AddInstalledSoftware(software, RegistryView.Registry64, "registry:hklm64");
            AddInstalledSoftware(software, RegistryView.Registry32, "registry:hklm32");
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["device_uuid"] = LoadOrCreateIdentity().device_uuid;
            body["hostname"] = Environment.MachineName;
            body["scan_started_at"] = started.ToString("o");
            body["scan_completed_at"] = DateTime.UtcNow.ToString("o");
            body["software"] = software;
            AgentConfig config = LoadConfig();
            SendJson(config.BackendUrl + "/api/v1/laptop-monitoring/software-inventory", body, LoadCredential());
            Log("INFO", "Software inventory synchronized. Records=" + software.Count + ".");
        }

        internal static void SubmitActivity(Dictionary<string, object> activity)
        {
            if (!LoadPolicy().activity_monitoring_enabled) { Log("INFO", "User activity rejected because effective policy/consent disables it."); return; }
            AgentConfig config = LoadConfig();
            DeviceIdentity identity = LoadOrCreateIdentity();
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["device_uuid"] = identity.device_uuid;
            body["hostname"] = Environment.MachineName;
            body["event_type"] = "active_window_sample";
            body["app_name"] = Truncate(Convert.ToString(Value(activity, "app_name")), 255);
            body["window_title"] = Truncate(Convert.ToString(Value(activity, "window_title")), 500);
            body["idle_seconds"] = Value(activity, "idle_seconds") ?? 0;
            body["url_domain"] = null;
            body["occurred_at"] = DateTime.UtcNow.ToString("o");
            SendJson(config.BackendUrl + "/api/v1/laptop-monitoring/activity", body, LoadCredential());
            Log("INFO", "Consent-approved activity sample synchronized.");
        }

        internal static void ConfigureUpdates(string manifestUrl, string thumbprint, string channel)
        {
            AgentConfig config = LoadConfig();
            if (!String.IsNullOrWhiteSpace(manifestUrl) && !manifestUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("The update manifest URL must use HTTPS.");
            config.UpdateManifestUrl = String.IsNullOrWhiteSpace(manifestUrl) ? null : manifestUrl.Trim();
            config.TrustedSignerThumbprint = NormalizeThumbprint(thumbprint);
            config.UpdateChannel = String.IsNullOrWhiteSpace(channel) ? "stable" : channel.Trim().ToLowerInvariant();
            SaveConfig(config);
        }

        internal static void CheckForUpdate()
        {
            AgentConfig config = LoadConfig();
            if (String.IsNullOrWhiteSpace(config.UpdateManifestUrl) || String.IsNullOrWhiteSpace(config.TrustedSignerThumbprint))
            {
                Log("INFO", "Automatic updates are disabled until a signed release URL and trusted signer thumbprint are configured.");
                return;
            }
            Dictionary<string, object> response = SendGetJson(config.UpdateManifestUrl, LoadCredential());
            Dictionary<string, object> data = GetDictionary(response, "data") ?? response;
            UpdateManifest manifest = Json.Deserialize<UpdateManifest>(Json.Serialize(data));
            if (manifest == null || String.IsNullOrWhiteSpace(manifest.version)) throw new InvalidOperationException("Update manifest is invalid.");
            if (!String.Equals(manifest.channel ?? "stable", config.UpdateChannel ?? "stable", StringComparison.OrdinalIgnoreCase)) return;
            if (CompareVersions(manifest.version, Version) <= 0) return;
            if (!IsHttps(manifest.service_download_url) || !IsHttps(manifest.companion_download_url)) throw new InvalidOperationException("Signed update downloads must use HTTPS.");

            string updateDirectory = Path.Combine(AgentPaths.Root, "updates", SafeFileName(manifest.version));
            Directory.CreateDirectory(updateDirectory);
            string stagedService = Path.Combine(updateDirectory, "AstreaBlue.Agent.Service.exe");
            string stagedCompanion = Path.Combine(updateDirectory, "AstreaBlue.ActivityCompanion.exe");
            DownloadFile(manifest.service_download_url, stagedService, LoadCredential());
            DownloadFile(manifest.companion_download_url, stagedCompanion, LoadCredential());
            VerifyUpdateFile(stagedService, manifest.service_sha256, config.TrustedSignerThumbprint);
            VerifyUpdateFile(stagedCompanion, manifest.companion_sha256, config.TrustedSignerThumbprint);

            string currentDirectory = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
            string updater = Path.Combine(currentDirectory, "AstreaBlue.Agent.Updater.exe");
            if (!File.Exists(updater)) throw new InvalidOperationException("Signed updater executable is missing.");
            ProcessStartInfo start = new ProcessStartInfo(updater);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.Arguments = Quote(stagedService) + " " + Quote(stagedCompanion) + " " + Quote(currentDirectory) + " " + Quote(manifest.version);
            Process.Start(start);
            Log("INFO", "Verified signed update " + manifest.version + "; rollback-capable updater started.");
        }

        internal static string Diagnostics()
        {
            Dictionary<string, object> report = new Dictionary<string, object>();
            report["version"] = Version;
            report["program_data"] = AgentPaths.Root;
            report["config_present"] = File.Exists(AgentPaths.Config);
            report["identity_present"] = File.Exists(AgentPaths.Identity);
            report["credential_present"] = File.Exists(AgentPaths.Credential);
            try
            {
                AgentConfig config = LoadConfig();
                DeviceIdentity identity = LoadOrCreateIdentity();
                string credential = LoadCredential();
                report["backend_url"] = config.BackendUrl;
                report["device_uuid"] = identity.device_uuid;
                report["credential_protected"] = credential.StartsWith("ABDEV-", StringComparison.Ordinal);
                Heartbeat();
                report["heartbeat"] = "success";
                report["healthy"] = true;
            }
            catch (Exception error)
            {
                report["heartbeat"] = "failed";
                report["healthy"] = false;
                report["error"] = error.Message;
            }
            return Json.Serialize(report);
        }

        private static string ActiveUser()
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT UserName FROM Win32_ComputerSystem"))
                foreach (ManagementObject item in searcher.Get()) return Convert.ToString(item["UserName"]);
            }
            catch { }
            return null;
        }

        private static Dictionary<string, object> WmiFirst(string query)
        {
            Dictionary<string, object> values = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementObject item in results)
                    {
                        foreach (PropertyData property in item.Properties) values[property.Name] = property.Value;
                        break;
                    }
                }
            }
            catch (Exception error) { Log("WARN", "One hardware inventory query was unavailable: " + error.Message); }
            return values;
        }

        private static object Value(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            return source.TryGetValue(key, out value) ? value : null;
        }

        private static object FirstArrayValue(Dictionary<string, object> source, string key)
        {
            object value = Value(source, key);
            Array values = value as Array;
            return values != null && values.Length > 0 ? values.GetValue(0) : value;
        }

        private static object BytesToGb(object value)
        {
            decimal bytes;
            return Decimal.TryParse(Convert.ToString(value), out bytes) ? Math.Round(bytes / 1073741824m, 2) : (object)null;
        }

        private static string Truncate(string value, int maximum)
        {
            if (String.IsNullOrEmpty(value) || value.Length <= maximum) return value;
            return value.Substring(0, maximum);
        }

        private static void AddInstalledSoftware(List<object> destination, RegistryView view, string source)
        {
            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
            using (RegistryKey uninstall = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (uninstall == null) return;
                foreach (string keyName in uninstall.GetSubKeyNames())
                {
                    if (destination.Count >= 2000) return;
                    using (RegistryKey entry = uninstall.OpenSubKey(keyName))
                    {
                        if (entry == null) continue;
                        string name = Convert.ToString(entry.GetValue("DisplayName"));
                        if (String.IsNullOrWhiteSpace(name)) continue;
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["software_name"] = Truncate(name.Trim(), 500);
                        item["version"] = Truncate(Convert.ToString(entry.GetValue("DisplayVersion")), 255);
                        item["publisher"] = Truncate(Convert.ToString(entry.GetValue("Publisher")), 255);
                        item["install_date"] = Truncate(Convert.ToString(entry.GetValue("InstallDate")), 50);
                        item["install_location"] = Truncate(Convert.ToString(entry.GetValue("InstallLocation")), 1000);
                        item["source"] = source;
                        destination.Add(item);
                    }
                }
            }
        }

        private static string NormalizeThumbprint(string value)
        {
            return String.IsNullOrWhiteSpace(value) ? null : value.Replace(" ", "").ToUpperInvariant();
        }

        private static bool IsHttps(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps;
        }

        private static string SafeFileName(string value)
        {
            StringBuilder safe = new StringBuilder();
            foreach (char character in value ?? "update") if (Char.IsLetterOrDigit(character) || character == '.' || character == '-' || character == '_') safe.Append(character);
            return safe.Length == 0 ? "update" : safe.ToString();
        }

        private static int CompareVersions(string candidate, string current)
        {
            Version left;
            Version right;
            string candidateValue = (candidate ?? "0").Replace("native-", "");
            string currentValue = (current ?? "0").Replace("native-", "");
            if (!System.Version.TryParse(candidateValue, out left)) return 0;
            if (!System.Version.TryParse(currentValue, out right)) return 0;
            return left.CompareTo(right);
        }

        private static void DownloadFile(string url, string destination, string credential)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = 120000;
            request.ReadWriteTimeout = 120000;
            request.Headers["x-agent-token"] = credential;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (Stream input = response.GetResponseStream())
            using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None)) input.CopyTo(output);
        }

        private static void VerifyUpdateFile(string file, string expectedHash, string expectedThumbprint)
        {
            if (String.IsNullOrWhiteSpace(expectedHash)) throw new InvalidOperationException("Update manifest is missing a SHA-256 digest.");
            string actualHash;
            using (SHA256 algorithm = SHA256.Create())
            using (FileStream stream = File.OpenRead(file)) actualHash = BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (!String.Equals(actualHash, expectedHash.Replace(" ", "").ToLowerInvariant(), StringComparison.Ordinal)) throw new InvalidOperationException("Update SHA-256 verification failed.");
            X509Certificate2 signer;
            try { signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(file)); }
            catch (Exception error) { throw new InvalidOperationException("Update is not Authenticode-signed.", error); }
            using (signer)
            {
                if (!String.Equals(NormalizeThumbprint(signer.Thumbprint), NormalizeThumbprint(expectedThumbprint), StringComparison.Ordinal)) throw new InvalidOperationException("Update signer is not trusted by this agent.");
                if (DateTime.UtcNow < signer.NotBefore.ToUniversalTime() || DateTime.UtcNow > signer.NotAfter.ToUniversalTime()) throw new InvalidOperationException("Update signing certificate is outside its validity period.");
            }
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
        }

        private static Dictionary<string, object> SendGetJson(string url, string credential)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Accept = "application/json";
            request.Timeout = 30000;
            request.UserAgent = "AstreaBlue-Agent/" + Version;
            request.Headers["x-agent-token"] = credential;
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream())) return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
            catch (WebException error)
            {
                throw BackendException(error);
            }
        }

        private static Dictionary<string, object> SendJson(string url, Dictionary<string, object> body, string credential)
        {
            byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(body));
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Accept = "application/json";
            request.Timeout = 30000;
            request.ReadWriteTimeout = 30000;
            request.UserAgent = "AstreaBlue-Agent/" + Version;
            if (!String.IsNullOrWhiteSpace(credential)) request.Headers["x-agent-token"] = credential;
            request.ContentLength = payload.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream())) return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
            catch (WebException error)
            {
                throw BackendException(error);
            }
        }

        private static Exception BackendException(WebException error)
        {
            string detail = error.Message;
            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response != null)
            {
                using (response)
                using (StreamReader reader = new StreamReader(response.GetResponseStream())) detail = reader.ReadToEnd();
            }
            return new InvalidOperationException("Backend request failed: " + detail, error);
        }

        private static Dictionary<string, object> GetDictionary(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            return value as Dictionary<string, object>;
        }
    }

    public sealed class AstreaBlueService : ServiceBase
    {
        private Timer heartbeatTimer;
        private Timer policyTimer;
        private Timer inventoryTimer;
        private Timer updateTimer;
        private Semaphore instanceLock;
        private int heartbeatRunning;
        private int policyRunning;
        private int inventoryRunning;
        private volatile bool pipeRunning;
        private Thread pipeThread;

        public AstreaBlueService() { ServiceName = "AstreaBlueMonitoringAgent"; CanStop = true; AutoLog = true; }

        protected override void OnStart(string[] args)
        {
            bool created;
            instanceLock = new Semaphore(1, 1, "Global\\AstreaBlueMonitoringAgent.Native.v1", out created);
            if (!instanceLock.WaitOne(0)) throw new InvalidOperationException("Another AstreaBlue agent instance is already running.");
            AgentConfig config = AgentRuntime.LoadConfig();
            heartbeatTimer = new Timer(delegate { RunHeartbeat(); }, null, TimeSpan.Zero, TimeSpan.FromSeconds(config.HeartbeatSeconds));
            policyTimer = new Timer(delegate { RunPolicySync(); }, null, TimeSpan.Zero, TimeSpan.FromMinutes(1));
            inventoryTimer = new Timer(delegate { RunInventory(); }, null, TimeSpan.FromSeconds(15), Timeout.InfiniteTimeSpan);
            updateTimer = new Timer(delegate { RunUpdateCheck(); }, null, TimeSpan.FromMinutes(5), TimeSpan.FromHours(6));
            StartActivityPipe();
            AgentRuntime.Log("INFO", "Native Windows service started.");
        }

        private void RunHeartbeat()
        {
            if (Interlocked.Exchange(ref heartbeatRunning, 1) == 1) return;
            try { AgentRuntime.Heartbeat(); }
            catch (Exception error) { AgentRuntime.Log("ERROR", "Heartbeat failed: " + error.Message); }
            finally { Interlocked.Exchange(ref heartbeatRunning, 0); }
        }

        private void RunPolicySync()
        {
            if (Interlocked.Exchange(ref policyRunning, 1) == 1) return;
            try { AgentRuntime.SyncPolicy(); }
            catch (Exception error) { AgentRuntime.Log("ERROR", "Policy synchronization failed; cached policy remains active: " + error.Message); }
            finally { Interlocked.Exchange(ref policyRunning, 0); }
        }

        private void RunInventory()
        {
            if (Interlocked.Exchange(ref inventoryRunning, 1) == 1) return;
            bool succeeded = true;
            try { AgentRuntime.SendHardwareInventory(); }
            catch (Exception error) { succeeded = false; AgentRuntime.Log("ERROR", "Hardware inventory failed: " + error.Message); }
            try { AgentRuntime.SendSoftwareInventory(); }
            catch (Exception error) { succeeded = false; AgentRuntime.Log("ERROR", "Software inventory failed: " + error.Message); }
            finally
            {
                Interlocked.Exchange(ref inventoryRunning, 0);
                if (inventoryTimer != null) inventoryTimer.Change(succeeded ? TimeSpan.FromHours(24) : TimeSpan.FromMinutes(5), Timeout.InfiniteTimeSpan);
            }
        }

        private void RunUpdateCheck()
        {
            try { AgentRuntime.CheckForUpdate(); }
            catch (Exception error) { AgentRuntime.Log("ERROR", "Automatic update check failed safely; current version remains active: " + error.Message); }
        }

        private void StartActivityPipe()
        {
            pipeRunning = true;
            pipeThread = new Thread(ActivityPipeLoop);
            pipeThread.IsBackground = true;
            pipeThread.Name = "AstreaBlueActivityPipe";
            pipeThread.Start();
        }

        private void ActivityPipeLoop()
        {
            while (pipeRunning)
            {
                try
                {
                    PipeSecurity security = new PipeSecurity();
                    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
                    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.Write, AccessControlType.Allow));
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream("AstreaBlueActivityV1", PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.None, 4096, 4096, security))
                    {
                        pipe.WaitForConnection();
                        using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8))
                        {
                            string line = reader.ReadLine();
                            if (!pipeRunning || String.IsNullOrWhiteSpace(line)) continue;
                            JavaScriptSerializer json = new JavaScriptSerializer();
                            Dictionary<string, object> activity = json.Deserialize<Dictionary<string, object>>(line);
                            AgentRuntime.SubmitActivity(activity);
                        }
                    }
                }
                catch (Exception error)
                {
                    if (pipeRunning) AgentRuntime.Log("ERROR", "Activity companion channel failed: " + error.Message);
                    Thread.Sleep(2000);
                }
            }
        }

        protected override void OnStop()
        {
            if (heartbeatTimer != null) { heartbeatTimer.Dispose(); heartbeatTimer = null; }
            if (policyTimer != null) { policyTimer.Dispose(); policyTimer = null; }
            if (inventoryTimer != null) { inventoryTimer.Dispose(); inventoryTimer = null; }
            if (updateTimer != null) { updateTimer.Dispose(); updateTimer = null; }
            pipeRunning = false;
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", "AstreaBlueActivityV1", PipeDirection.Out)) { client.Connect(1000); }
            }
            catch { }
            if (instanceLock != null) { instanceLock.Release(); instanceLock.Dispose(); instanceLock = null; }
            AgentRuntime.Log("INFO", "Native Windows service stopped.");
        }
    }

    internal static class Program
    {
        private static string Arg(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++) if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            return null;
        }

        private static int Main(string[] args)
        {
            try
            {
                if (args.Length > 0 && String.Equals(args[0], "--enroll", StringComparison.OrdinalIgnoreCase))
                {
                    AgentRuntime.Enroll(Arg(args, "--backend"), Arg(args, "--code"), Arg(args, "--name"));
                    Console.WriteLine("Enrollment successful.");
                    return 0;
                }
                if (args.Length > 0 && String.Equals(args[0], "--heartbeat-once", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.Heartbeat(); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--policy-once", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.SyncPolicy(); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--hardware-once", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.SendHardwareInventory(); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--software-once", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.SendSoftwareInventory(); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--update-once", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.CheckForUpdate(); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--configure-updates", StringComparison.OrdinalIgnoreCase)) { AgentRuntime.ConfigureUpdates(Arg(args, "--manifest"), Arg(args, "--thumbprint"), Arg(args, "--channel")); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--diagnostics", StringComparison.OrdinalIgnoreCase)) { Console.WriteLine(AgentRuntime.Diagnostics()); return 0; }
                if (args.Length > 0 && String.Equals(args[0], "--version", StringComparison.OrdinalIgnoreCase)) { Console.WriteLine(AgentRuntime.Version); return 0; }
                ServiceBase.Run(new AstreaBlueService());
                return 0;
            }
            catch (Exception error)
            {
                AgentRuntime.Log("ERROR", error.ToString());
                Console.Error.WriteLine(error.Message);
                return 1;
            }
        }
    }
}

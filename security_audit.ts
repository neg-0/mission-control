import { NotificationService } from './src/lib/services/NotificationService';

async function testSecurity() {
  console.log("--- 🛡️ Security Test: SSRF Prevention ---");
  const malicousUrls = [
    "http://localhost:3000/admin",
    "http://127.0.0.1/config",
    "http://169.254.169.254/latest/meta-data/", // AWS Metadata
    "not-a-url"
  ];

  for (const url of malicousUrls) {
    const result = await NotificationService.sendSlackNotification(url, "Test");
    console.log(`URL: ${url} -> Blocked: ${!result.success}`);
  }
}

testSecurity();

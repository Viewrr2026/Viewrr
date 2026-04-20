import { Link } from "wouter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-10">
          <Link href="/" className="text-primary text-sm font-medium hover:underline">← Back to Viewrr</Link>
          <h1 className="text-4xl font-bold mt-6 mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: April 2026</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Who We Are</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr is a UK-based online marketplace for creative freelancers. We are committed to protecting your personal data and complying with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. This Privacy Policy explains how we collect, use, and protect your information.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Data We Collect</h2>
            <p className="text-muted-foreground leading-relaxed">We may collect the following types of personal data:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Account information</strong> — name, email address, password (encrypted)</li>
              <li><strong className="text-foreground">Profile information</strong> — bio, location, skills, portfolio, profile photo</li>
              <li><strong className="text-foreground">Payment information</strong> — processed securely via Stripe; we do not store card details</li>
              <li><strong className="text-foreground">Usage data</strong> — pages visited, features used, time on site</li>
              <li><strong className="text-foreground">Communications</strong> — messages sent between users on the platform</li>
              <li><strong className="text-foreground">Device &amp; technical data</strong> — IP address, browser type, operating system</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Data</h2>
            <p className="text-muted-foreground leading-relaxed">We use your personal data to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li>Provide and operate the Viewrr platform</li>
              <li>Process subscription payments and transactions</li>
              <li>Match clients with suitable freelancers (including AI-powered matching)</li>
              <li>Send transactional emails (account confirmation, project updates)</li>
              <li>Improve the platform through analytics and usage data</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr uses cookies to improve your experience on our platform. Cookies are small text files stored on your device. We use the following types:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Essential cookies</strong> — required for the platform to function (e.g. session management). These cannot be disabled.</li>
              <li><strong className="text-foreground">Analytics cookies</strong> — help us understand how users interact with Viewrr so we can improve it (e.g. page views, session duration).</li>
              <li><strong className="text-foreground">Preference cookies</strong> — remember your settings such as dark/light mode.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">You can manage your cookie preferences at any time via the cookie banner or your browser settings.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Legal Basis for Processing</h2>
            <p className="text-muted-foreground leading-relaxed">Under UK GDPR, we process your data on the following legal bases:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Contract</strong> — processing necessary to provide the service you have signed up for</li>
              <li><strong className="text-foreground">Legitimate interests</strong> — improving the platform, preventing fraud, ensuring security</li>
              <li><strong className="text-foreground">Consent</strong> — for analytics cookies and marketing communications</li>
              <li><strong className="text-foreground">Legal obligation</strong> — where required by law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Sharing</h2>
            <p className="text-muted-foreground leading-relaxed">We do not sell your personal data. We may share data with trusted third-party service providers who help us operate the platform, including payment processors (Stripe), cloud infrastructure providers, and analytics services. All third parties are required to handle your data securely and in accordance with UK GDPR.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">We retain your personal data for as long as your account is active or as needed to provide services. If you close your account, we will delete or anonymise your data within 90 days, except where we are required to retain it for legal or compliance purposes.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">Under UK GDPR, you have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Access</strong> — request a copy of the personal data we hold about you</li>
              <li><strong className="text-foreground">Rectification</strong> — ask us to correct inaccurate data</li>
              <li><strong className="text-foreground">Erasure</strong> — ask us to delete your data ("right to be forgotten")</li>
              <li><strong className="text-foreground">Restriction</strong> — ask us to limit how we use your data</li>
              <li><strong className="text-foreground">Portability</strong> — receive your data in a portable format</li>
              <li><strong className="text-foreground">Objection</strong> — object to processing based on legitimate interests</li>
              <li><strong className="text-foreground">Withdraw consent</strong> — where processing is based on consent</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">To exercise any of these rights, contact us at <span className="text-primary">privacy@viewrr.co.uk</span>. You also have the right to lodge a complaint with the Information Commissioner's Office (ICO) at <span className="text-primary">ico.org.uk</span>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Security</h2>
            <p className="text-muted-foreground leading-relaxed">We take appropriate technical and organisational measures to protect your personal data against unauthorised access, loss, or destruction. All data is transmitted over HTTPS and passwords are stored using industry-standard encryption.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">We may update this Privacy Policy from time to time. We will notify you of significant changes via email or a notice on the platform. The date at the top of this page indicates when it was last updated.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">For any privacy-related questions, contact us at <span className="text-primary">privacy@viewrr.co.uk</span>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}

import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-10">
          <Link href="/" className="text-primary text-sm font-medium hover:underline">← Back to Viewrr</Link>
          <h1 className="text-4xl font-bold mt-6 mb-2">Terms &amp; Conditions</h1>
          <p className="text-muted-foreground text-sm">Last updated: April 2026</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. About Viewrr</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr is an online marketplace platform operated in the United Kingdom that connects clients and businesses with freelance creative professionals including videographers, video editors, photographers, and marketers. By accessing or using Viewrr, you agree to be bound by these Terms &amp; Conditions.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Eligibility</h2>
            <p className="text-muted-foreground leading-relaxed">You must be at least 18 years of age to use Viewrr. By creating an account, you confirm that you are 18 or older and that all information you provide is accurate and truthful. Viewrr reserves the right to suspend or terminate accounts that provide false information.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. User Accounts</h2>
            <p className="text-muted-foreground leading-relaxed">You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must notify Viewrr immediately of any unauthorised use of your account. Viewrr cannot and will not be liable for any loss or damage arising from your failure to comply with this obligation.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Freelancer Responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">Freelancers using Viewrr agree to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li>Provide accurate information about their skills, experience, and portfolio</li>
              <li>Only upload content they own or have the legal right to use</li>
              <li>Deliver work to the standard and timeline agreed with the client</li>
              <li>Behave professionally and respectfully toward all users</li>
              <li>Comply with all applicable UK tax and self-employment obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Client Responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">Clients using Viewrr agree to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li>Provide clear and accurate project briefs</li>
              <li>Communicate in good faith and in a timely manner</li>
              <li>Not solicit freelancers to work outside the platform in order to avoid platform fees</li>
              <li>Respect the intellectual property rights of freelancers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Pro Viewrr Subscription</h2>
            <p className="text-muted-foreground leading-relaxed">Freelancers may subscribe to Pro Viewrr for £49.99 per month. Pro Viewrr subscribers receive priority placement at the top of the Browse Talent page. Subscriptions are billed monthly and renew automatically. You may cancel at any time, and your Pro status will remain active until the end of the current billing period. Refunds are not provided for partial billing periods. Viewrr reserves the right to change subscription pricing with 30 days' notice.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Prohibited Content</h2>
            <p className="text-muted-foreground leading-relaxed">Users must not upload, post, or share content that is:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li>Illegal, defamatory, fraudulent, or misleading</li>
              <li>Infringing on any third party's intellectual property rights</li>
              <li>Sexually explicit, violent, or otherwise offensive</li>
              <li>Spam, advertising, or unsolicited promotional material</li>
              <li>Malware, viruses, or any harmful code</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">Freelancers retain ownership of all work they create until full payment has been received, unless otherwise agreed in writing. Upon payment, ownership transfers to the client as agreed. Viewrr does not claim ownership of any content uploaded by users, but you grant Viewrr a non-exclusive licence to display your content on the platform for the purposes of providing the service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr acts solely as an intermediary platform and is not a party to any agreement made between clients and freelancers. Viewrr is not liable for the quality, safety, legality, or delivery of any services arranged through the platform. To the fullest extent permitted by UK law, Viewrr's total liability to you shall not exceed the amount you have paid to Viewrr in the 3 months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr reserves the right to suspend or permanently terminate any account that violates these Terms &amp; Conditions, without notice and without liability. You may close your account at any time by contacting us.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">These Terms &amp; Conditions are governed by the laws of England and Wales. Any disputes arising from the use of Viewrr shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Changes to These Terms</h2>
            <p className="text-muted-foreground leading-relaxed">Viewrr may update these Terms &amp; Conditions from time to time. We will notify registered users of material changes by email or by a prominent notice on the platform. Continued use of Viewrr after changes take effect constitutes your acceptance of the revised terms.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">If you have any questions about these Terms &amp; Conditions, please contact us at <span className="text-primary">legal@viewrr.co.uk</span>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}

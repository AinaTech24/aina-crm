/** The new landing page's footer (public/landing/index.html), for the Knowledge Base pages. */

const DEMO =
  "https://wa.me/918200770942?text=Hi%2C%20I'd%20like%20a%20demo%20of%20Aina%20CRM%20for%20my%20MFD%20practice.";

export function KbFooter() {
  return (
    <footer className="site">
      <div className="kb-w">
        <div className="fg">
          <div>
            <a className="pill-box" href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/images/logo.png" alt="AINA CRM" style={{ height: "2.5rem", width: "auto", display: "block" }} />
            </a>
            <p className="mt"><b style={{ color: "var(--ink)" }}>AINA CRM — A smarter way to manage your MFD business.</b></p>
            <p>CRM software for Mutual Fund Distributors in India: leads, clients, SIPs, reviews, tasks and business tracking in one place.</p>
          </div>
          <div>
            <h4>Solutions</h4>
            <ul>
              <li><a href="/solutions/crm-for-mutual-fund-distributors">CRM for Mutual Fund Distributors</a></li>
              <li><a href="/solutions/mutual-fund-software-for-distributors">Mutual Fund Software for Distributors</a></li>
              <li><a href="/solutions/ddq-compliance-for-mutual-fund-distributors">AMFI DDQ Compliance for MFDs</a></li>
              <li><a href="/solutions/sip-tracking-software">SIP Tracking &amp; SIP Rejection Follow-up</a></li>
            </ul>
          </div>
          <div>
            <h4>AINA CRM</h4>
            <ul>
              <li><a href={DEMO} target="_blank" rel="noopener noreferrer">Book a Demo</a></li>
              <li><a href="https://chat.whatsapp.com/C6ttmFYUtxHA7GYna5YGcN" target="_blank" rel="noopener noreferrer">Community</a></li>
              <li><a href="/blog">Blog</a></li>
              <li><a href="/login">Log in</a></li>
              <li><a href="/privacy">Privacy</a></li>
              <li><a href="/terms">Terms</a></li>
              <li><a href="/refund">Refunds</a></li>
            </ul>
          </div>
          <div>
            <h4>Reach us</h4>
            <ul>
              <li>Aina Tech Services LLP,<br />317, 3rd Floor, Krishna Shrey Complex, Nr. Sanket Sales, Raj Marg, Anand, Gujarat 388001</li>
              <li><a href="mailto:info@ainatech.in">info@ainatech.in</a></li>
              <li><a href="tel:+918200770942">+91 82007 70942</a></li>
              <li><a href="https://wa.me/918200770942" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a></li>
            </ul>
          </div>
        </div>
        <div className="cp">
          <p>© 2026 · Developed by <a href="https://ainatech.in">Aina Tech Services LLP</a></p>
          <p className="disc">Mutual fund investments are subject to market risks. Read all scheme-related documents carefully. AINA CRM provides practice-management, analytics and communication tools for distributors and does not execute mutual fund transactions.</p>
        </div>
      </div>
    </footer>
  );
}

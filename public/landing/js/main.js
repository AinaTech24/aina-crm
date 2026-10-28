/* AINA CRM landing page — vanilla JS, no framework. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- scroll progress, nav highlight ---------- */
  const bar = $("#progress");
  const navLinks = $$("#navLinks a");
  const sections = navLinks.map((a) => $(a.getAttribute("href")));
  function onScroll() {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    let cur = -1;
    const y = innerHeight * 0.35;
    sections.forEach((el, i) => { if (el && el.getBoundingClientRect().top < y) cur = i; });
    navLinks.forEach((a, i) => a.classList.toggle("cur", i === cur));
  }
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { passive: true });
  onScroll();

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    $$(".rv").forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 0.07}s`;
      io.observe(el);
    });
  } else {
    document.documentElement.classList.remove("js");
  }

  /* ---------- ticker: duplicate content for a seamless loop ---------- */
  $$("[data-loop]").forEach((row) => {
    const spans = $$("span", row);
    if (row.hasAttribute("data-reverse")) spans.reverse().forEach((s) => row.appendChild(s));
    row.innerHTML += row.innerHTML;
  });

  /* ---------- hero: fan of screens + "right now in your practice" feed ---------- */
  const fan = $$("#heroVisual .hv-c");
  const toast = $(".hv-toast");
  const FEED = [
    ["Risk profile due", "Patel family", "Link sent · client confirms by OTP"],
    ["CAMS feed imported", "214 transactions", "Matched to the right clients"],
    ["SIP bounced", "Riya Shah · ₹10,000", "RM task + WhatsApp sent"],
    ["Complaint from website", "Ticket SR-2026-00412", "Routed to compliance · 21-day SLA"],
    ["Proposal approved", "Neha Iyer · new SIP", "Journey moves to KYC"],
    ["FD matures in 15 days", "₹5,00,000 · SBI", "Reminder task to the RM"],
    ["Message drafted", "Diwali campaign", "Compliance · 11 of 11 passed"],
    ["Birthday tomorrow", "Arjun Mehta", "Wishes scheduled for 9:00"],
  ];
  let tick = 0;
  setInterval(() => {
    tick++;
    fan.forEach((c, i) => c.classList.toggle("on", i === tick % fan.length));
    const a = FEED[tick % FEED.length];
    $("#toastTitle").textContent = a[0];
    $("#toastSub").textContent = a[1];
    $("#toastRes").textContent = a[2];
    toast.classList.remove("swap");
    void toast.offsetWidth;
    toast.classList.add("swap");
  }, 2800);

  /* ---------- problem tabs ---------- */
  const pt = $("#problemTabs");
  if (pt) {
    const btns = $$(".pt-list button", pt);
    const panel = $(".pt-panel", pt);
    const dots = $("#ptDots");
    btns.forEach(() => dots.appendChild(document.createElement("i")));
    const show = (i) => {
      btns.forEach((b, n) => { b.classList.toggle("on", n === i); b.setAttribute("aria-selected", n === i); });
      $$("i", dots).forEach((d, n) => d.classList.toggle("on", n === i));
      $("#ptBig").textContent = String(i + 1).padStart(2, "0");
      $("#ptTitle").textContent = btns[i].childNodes[1].textContent;
      $("#ptDesc").textContent = btns[i].dataset.d;
      panel.classList.remove("swap");
      void panel.offsetWidth;
      panel.classList.add("swap");
    };
    btns.forEach((b, i) => b.addEventListener("click", () => show(i)));
    show(0);
  }

  /* ---------- benefits: three dashboards (same as crm.ainatech.in) ---------- */
  const ICONS = {
    owner: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z\"/><path d=\"M5 21h14\"/></svg>",
    rm: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"8\" r=\"5\"/><path d=\"M20 21a8 8 0 0 0-16 0\"/></svg>",
    ops: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\"/></svg>",
  };
  const AUD = {
    owner: { title: "Owner Dashboard", tiles: [["AUM", "₹48.6 Cr", "Balance today"], ["Net business", "₹2.1 Cr", "This financial year"], ["Team tasks open", "38", "Across 6 people"], ["Overdue", "4", "Need attention", 1]] },
    rm: { title: "My Day", tiles: [["Meetings today", "3", "Next at 11:30"], ["Follow-ups due", "9", "Leads & clients"], ["Reviews this week", "6", "Client reviews"], ["Overdue", "2", "Act now", 1]] },
    ops: { title: "Operations Queue", tiles: [["Open requests", "34", "In the queue"], ["Due today", "11", "Assigned work"], ["SIP exceptions", "5", "To follow up"], ["Past SLA", "3", "Escalated", 1]] },
  };
  const audTabs = $$("#audTabs button");
  const audStats = $("#audStats");
  function showAud(key) {
    const d = AUD[key];
    audTabs.forEach((b) => { const on = b.dataset.aud === key; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $("#audIcon").innerHTML = ICONS[key];
    $("#audTitle").textContent = d.title;
    audStats.innerHTML = d.tiles.map((t) => '<div class="bs' + (t[3] ? " warn" : "") + '"><small>' + t[0] + "</small><b>" + t[1] + "</b><span>" + t[2] + "</span></div>").join("");
    audStats.classList.remove("swap");
    void audStats.offsetWidth;
    audStats.classList.add("swap");
    document.dispatchEvent(new CustomEvent("aud:render"));
  }
  audTabs.forEach((b) => {
    b.addEventListener("click", () => showAud(b.dataset.aud));
    b.addEventListener("mouseenter", () => { if (matchMedia("(hover: hover)").matches) showAud(b.dataset.aud); });
  });
  showAud("owner");

  /* ---------- mobile menu ---------- */
  const burger = $("#navBurger");
  const linksEl = $("#navLinks");
  const setMenu = (open) => { linksEl.classList.toggle("open", open); burger.setAttribute("aria-expanded", open); burger.setAttribute("aria-label", open ? "Close menu" : "Open menu"); };
  burger.addEventListener("click", () => setMenu(!linksEl.classList.contains("open")));
  $$("a", linksEl).forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
})();

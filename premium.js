/* Vellops — premium scroll reveal (2026-10-27). Presentation only.
   Adds .rv ONLY to elements below the fold, then reveals them on
   scroll. No-JS / no-IntersectionObserver = everything stays visible. */
(function () {
  try {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var els = document.querySelectorAll(
      "section .card, section .trust-item, .price, ol.steps li, .faq details, .step, .panel, .article .stat .box"
    );
    var fold = window.innerHeight * 0.94;
    var targets = [];
    els.forEach(function (e) {
      if (e.getBoundingClientRect().top > fold) {
        e.classList.add("rv");
        targets.push(e);
      }
    });
    if (!targets.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.06, rootMargin: "0px 0px -3% 0px" });
    targets.forEach(function (e) { io.observe(e); });
    /* Safety: never leave content hidden if observation stalls. */
    setTimeout(function () {
      targets.forEach(function (e) {
        if (e.getBoundingClientRect().top < window.innerHeight) e.classList.add("in");
      });
    }, 3000);
  } catch (e) { /* presentation only — fail silent */ }
})();

/* PWA install prompt + service-worker registration/update flow. */

const $ = (id) => document.getElementById(id);

function showUpdateToast(worker) {
  const toast = $("updateToast");
  const btn = $("updateBtn");
  if (!toast || !worker) return;
  toast.hidden = false;
  btn.onclick = () => {
    btn.textContent = "Updating…";
    btn.disabled = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  };
}

export function initPwa() {
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("installBtn").hidden = false;
  });
  $("installBtn").onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("installBtn").hidden = true;
  };

  // --- Service worker + "new version available" prompt ---
  if ("serviceWorker" in navigator) {
    let reloading = false;
    // When the new worker takes control, reload once to pick up fresh assets.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });

    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("sw.js");

        // A new version was already downloaded and is waiting.
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);

        // A new version is being downloaded right now.
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            // installed + an existing controller means it's an update, not first install.
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(reg.waiting || nw);
            }
          });
        });

        // Check the server for a newer version periodically and on refocus.
        const checkForUpdate = () => reg.update().catch(() => {});
        setInterval(checkForUpdate, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });
      } catch (_) { /* ignore */ }
    });
  }
}

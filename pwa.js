let deferredInstallPrompt = null;
const installButton = document.getElementById('install-app-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredInstallPrompt = e;
  // Update UI to notify the user they can install the PWA
  if (installButton && window.matchMedia('(display-mode: browser)').matches) {
    installButton.style.display = 'block';
  }
});

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      return;
    }
    // Show the install prompt
    deferredInstallPrompt.prompt();
    // Wait for the user to respond to the prompt
    await deferredInstallPrompt.userChoice;
    // We've used the prompt, and can't use it again, throw it away
    deferredInstallPrompt = null;
    // Hide the install button
    installButton.style.display = 'none';
  });
}

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (installButton) {
    installButton.style.display = 'none';
  }
});

function showUpdateBar() {
  const updateBar = document.getElementById('update-bar');
  if (updateBar) {
    updateBar.classList.add('show');
    document.getElementById('update-now').onclick = () => {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ action: 'skipWaiting' });
        }
      });
    };
    document.getElementById('update-later').onclick = () => {
      updateBar.classList.remove('show');
    };
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(registration => {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);

      // Check if there's a waiting service worker to show the update bar immediately
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBar();
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBar();
            }
          });
        }
      });
    }).catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });

    let refreshing;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      window.location.reload();
      refreshing = true;
    });
  });
}
let deferredInstallPrompt = null;
const installButton = document.getElementById('install-app-btn');
const updateButton = document.getElementById('update-now');
const updateMessage = document.getElementById('update-message');
const originalUpdateButtonText = updateButton ? updateButton.textContent : '';
const originalUpdateMessageText = updateMessage ? updateMessage.textContent : '';
const UPDATE_TIMEOUT_MS = 12000;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let updateInProgress = false;
let reloadTriggered = false;
let updateTimeoutId = null;
let serviceWorkerRegistration = null;
let updateCheckInProgress = false;
let lastUpdateCheckAt = 0;
let versionRequestWorker = null;
let versionRequestPromise = null;
let displayedUpdateWorker = null;
const appShellRevision = window.APP_SHELL_REVISION || 'unknown';

function requestWorkerDiagnostics(worker) {
  if (!worker) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeoutId = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = event => {
      clearTimeout(timeoutId);
      resolve(event.data && event.data.action === 'updateDiagnostics'
        ? event.data : null);
    };
    try {
      worker.postMessage({ action: 'getUpdateDiagnostics' }, [channel.port2]);
    } catch (error) {
      clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

function refreshPwaUpdateDiagnostics() {
  const target = document.getElementById('pwa-update-diagnostics');
  const registration = serviceWorkerRegistration;
  const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
  return Promise.all([
    requestWorkerDiagnostics(registration && registration.active),
    requestWorkerDiagnostics(registration && registration.waiting),
    requestWorkerDiagnostics(registration && registration.installing)
  ]).then(values => {
    const diagnostic = {
      activeWorkerCacheRevision: values[0] && values[0].cacheRevision || null,
      waitingWorker: values[1] && values[1].cacheRevision || null,
      installingWorker: values[2] && values[2].cacheRevision || null,
      controllerScriptURL: controller && controller.scriptURL || null,
      appShellRevision: appShellRevision
    };
    if (target) target.textContent = JSON.stringify(diagnostic, null, 2);
    return diagnostic;
  });
}

window.PWAUpdateDiagnostics = Object.freeze({getState:refreshPwaUpdateDiagnostics});

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

function restoreUpdateUi(message) {
  if (updateTimeoutId !== null) {
    clearTimeout(updateTimeoutId);
    updateTimeoutId = null;
  }
  updateInProgress = false;
  if (updateButton) {
    updateButton.disabled = false;
    updateButton.textContent = originalUpdateButtonText;
  }
  if (updateMessage) {
    updateMessage.textContent = message || originalUpdateMessageText;
    if (message) {
      setTimeout(() => {
        if (!updateInProgress && updateMessage.textContent === message) {
          updateMessage.textContent = originalUpdateMessageText;
        }
      }, 5000);
    }
  }
}

function checkForServiceWorkerUpdate() {
  if (!serviceWorkerRegistration) {
    return Promise.resolve();
  }
  if (serviceWorkerRegistration.waiting) {
    showUpdateBar(serviceWorkerRegistration.waiting);
    return Promise.resolve();
  }
  if (!navigator.onLine || updateCheckInProgress) {
    return Promise.resolve();
  }

  const now = Date.now();
  if (now - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) {
    return Promise.resolve();
  }

  updateCheckInProgress = true;
  lastUpdateCheckAt = now;

  return Promise.resolve()
    .then(() => serviceWorkerRegistration.update())
    .catch(() => null)
    .then(() => {
      updateCheckInProgress = false;
    });
}

function getWorkerVersion(worker) {
  if (!worker) {
    return Promise.resolve('');
  }
  if (versionRequestWorker === worker && versionRequestPromise) {
    return versionRequestPromise;
  }

  versionRequestWorker = worker;
  versionRequestPromise = new Promise(resolve => {
    let channel;
    try {
      channel = new MessageChannel();
    } catch (error) {
      resolve('');
      return;
    }

    let settled = false;
    let timeoutId = null;

    const finish = version => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(version);
    };

    timeoutId = setTimeout(() => {
      finish('');
    }, 2500);

    channel.port1.onmessage = event => {
      const data = event.data;
      const version = data &&
        data.action === 'versionInfo' &&
        typeof data.version === 'string'
        ? data.version.trim()
        : '';
      finish(version);
    };

    try {
      worker.postMessage({ action: 'getVersion' }, [channel.port2]);
    } catch (error) {
      finish('');
    }
  });

  return versionRequestPromise;
}

function showUpdateBar(worker) {
  const updateBar = document.getElementById('update-bar');
  if (updateBar) {
    updateBar.classList.add('show');
    if (!updateInProgress && updateMessage) {
      updateMessage.textContent = originalUpdateMessageText;
    }
    if (worker) {
      displayedUpdateWorker = worker;
      getWorkerVersion(worker).then(version => {
        if (
          version &&
          displayedUpdateWorker === worker &&
          updateBar.classList.contains('show') &&
          updateMessage
        ) {
          updateMessage.textContent = 'يتوفر الإصدار ' + version + ' من البرنامج';
        }
      });
    }
    refreshPwaUpdateDiagnostics();
    updateButton.onclick = () => {
      if (updateInProgress) return;
      updateInProgress = true;
      updateButton.disabled = true;
      updateButton.textContent = 'جارٍ التحديث…';

      const registrationPromise = serviceWorkerRegistration
        ? Promise.resolve(serviceWorkerRegistration)
        : navigator.serviceWorker.getRegistration();

      registrationPromise.then(reg => {
        if (!reg || !reg.waiting) {
          restoreUpdateUi('لا يوجد تحديث جاهز الآن. يرجى المحاولة مرة أخرى.');
          return;
        }
        reg.waiting.postMessage({ action: 'skipWaiting' });
        updateTimeoutId = setTimeout(() => {
          restoreUpdateUi('لم يكتمل التحديث. يرجى المحاولة مرة أخرى.');
        }, UPDATE_TIMEOUT_MS);
      }).catch(() => {
        restoreUpdateUi('تعذر بدء التحديث. يرجى المحاولة مرة أخرى.');
      });
    };
    document.getElementById('update-later').onclick = () => {
      if (updateInProgress) return;
      updateBar.classList.remove('show');
    };
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js',{
      updateViaCache:'none'
    }).then(registration => {
      serviceWorkerRegistration = registration;
      console.log('ServiceWorker registration successful with scope: ', registration.scope);

      // Check if there's a waiting service worker to show the update bar immediately
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBar(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBar(registration.waiting || newWorker);
            }
          });
        }
      });

      checkForServiceWorkerUpdate();
      refreshPwaUpdateDiagnostics();
    }).catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateInProgress || reloadTriggered) return;
      reloadTriggered = true;
      if (updateTimeoutId !== null) {
        clearTimeout(updateTimeoutId);
        updateTimeoutId = null;
      }
      window.location.reload();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForServiceWorkerUpdate();
    }
  });

  window.addEventListener('online', () => {
    checkForServiceWorkerUpdate();
  });
}

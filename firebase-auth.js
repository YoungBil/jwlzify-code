const firebaseConfig = {
    apiKey:            "AIzaSyCj_SX2KRIsxaSI29Lid7CEVyZeKGaHOoo",
    authDomain:        "jwlzify-193c2.firebaseapp.com",
    projectId:         "jwlzify-193c2",
    storageBucket:     "jwlzify-193c2.firebasestorage.app",
    messagingSenderId: "840627245145",
    appId:             "1:840627245145:web:aecf1e85782b1be4526148",
    measurementId:     "G-96YLG3FSVK"
  };

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

/* ── Inject sign-in modal ── */
(function injectModal() {
  var modal = document.createElement('div');
  modal.id = 'signInModal';
  modal.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:rgba(27,28,28,0.55)',
    'backdrop-filter:blur(4px)',
    '-webkit-backdrop-filter:blur(4px)',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  modal.innerHTML = [
    '<div style="background:#fff;border-radius:20px;padding:44px 40px 36px;width:360px;max-width:90vw;',
             'box-shadow:0 24px 64px rgba(0,0,0,0.14);position:relative;text-align:center;">',
      '<button onclick="closeSignInModal()" style="position:absolute;top:16px;right:16px;background:none;border:none;',
              'cursor:pointer;color:#9ca3af;font-size:20px;line-height:1;padding:4px;">&#x2715;</button>',
      '<p style="font-family:\'Playfair Display\',serif;font-size:22px;font-weight:700;color:#1b1c1c;',
              'margin:0 0 6px;">Welcome to Jwlzify</p>',
      '<p style="font-family:Inter,sans-serif;font-size:13px;color:#6b7280;margin:0 0 32px;',
              'line-height:1.5;">Sign in to save designs, track orders,<br>and access your account.</p>',
      '<button onclick="doGoogleSignIn()" style="display:flex;align-items:center;justify-content:center;gap:12px;',
              'width:100%;padding:13px 20px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;',
              'cursor:pointer;font-family:Inter,sans-serif;font-size:14px;font-weight:500;color:#1b1c1c;',
              'transition:background 0.15s,box-shadow 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.06);"',
              'onmouseover="this.style.background=\'#f9fafb\';this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.10)\'"',
              'onmouseout="this.style.background=\'#fff\';this.style.boxShadow=\'0 1px 3px rgba(0,0,0,0.06)\'">',
        '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.58-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>',
        'Continue with Google',
      '</button>',
      '<p style="font-family:Inter,sans-serif;font-size:11px;color:#9ca3af;margin:24px 0 0;line-height:1.5;">',
        'By signing in you agree to our <a href="legal.html" style="color:#3c6474;text-decoration:none;">Terms & Privacy Policy</a>.',
      '</p>',
    '</div>',
  ].join('');

  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeSignInModal();
  });

  document.addEventListener('DOMContentLoaded', function() {
    document.body.appendChild(modal);
  });
})();

window.signInWithGoogle = function() {
  var modal = document.getElementById('signInModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
};

window.closeSignInModal = function() {
  var modal = document.getElementById('signInModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
};

window.doGoogleSignIn = function() {
  const auth     = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then((result) => {
      closeSignInModal();
      console.log('Success:', result.user.displayName);
    })
    .catch((error) => {
      if (error.code === 'auth/popup-blocked') {
        auth.signInWithRedirect(provider);
      } else {
        console.error('Error:', error.code, error.message);
      }
    });
};

firebase.auth().onAuthStateChanged((user) => {
  const signInBtn  = document.getElementById('signInBtn');
  const userMenu   = document.getElementById('userMenu');
  const userAvatar = document.getElementById('userAvatar');
  const userName   = document.getElementById('userName');

  if (user) {
    if (signInBtn)  signInBtn.style.display  = 'none';
    if (userMenu)   userMenu.style.display   = 'flex';
    if (userAvatar) userAvatar.src = user.photoURL || '';
    if (userName)   userName.textContent =
      user.displayName?.split(' ')[0] || 'Account';

    var dd = document.getElementById('userDropdown');
    if (dd && !dd.querySelector('[data-jwl-account]')) {
      var btn = document.createElement('button');
      btn.setAttribute('data-jwl-account', '');
      btn.onclick = function() { window.location.href = 'account.html'; };
      btn.style.cssText = 'width:100%;text-align:left;padding:10px 14px;font-family:Inter;font-size:13px;color:#1b1c1c;background:transparent;border:none;border-radius:8px;cursor:pointer;transition:background 0.15s ease;';
      btn.textContent = 'My Account';
      btn.onmouseover = function() { this.style.background = '#f5f3f3'; };
      btn.onmouseout  = function() { this.style.background = 'transparent'; };
      dd.insertBefore(btn, dd.firstChild);
    }
  } else {
    if (signInBtn)  signInBtn.style.display  = 'block';
    if (userMenu)   userMenu.style.display   = 'none';
  }
});

window.signOut = function() {
  firebase.auth().signOut();
  var dd = document.getElementById('userDropdown');
  if (dd) dd.style.display = 'none';
};

window.toggleDropdown = function() {
  var dd = document.getElementById('userDropdown');
  if (dd) dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
};

document.addEventListener('click', function(e) {
  var menu = document.getElementById('userMenu');
  var dd   = document.getElementById('userDropdown');
  if (menu && dd && !menu.contains(e.target)) {
    dd.style.display = 'none';
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSignInModal();
});

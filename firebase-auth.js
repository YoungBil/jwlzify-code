/* REPLACE WITH YOUR FIREBASE CONFIG */
const firebaseConfig = {
  apiKey: "AIzaSyAUzGJOBj7atcEX2XkS_LXpUs1wbWnWaV0",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const _jwlzAuth = firebase.auth();
const _jwlzProvider = new firebase.auth.GoogleAuthProvider();

function _jwlzRenderAuth(user) {
  document.querySelectorAll('[id="authBtnWrapper"]').forEach(function(el) {
    if (user) {
      var name = user.displayName ? user.displayName.split(' ')[0] : 'Account';
      var photo = user.photoURL || '';
      el.innerHTML =
        '<div class="relative" id="jwlzUserMenu">' +
        '<button onclick="_jwlzToggleMenu()" style="background:none;border:none;display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 8px;border-radius:8px;">' +
        (photo ? '<img src="' + photo + '" alt="' + name + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">' : '') +
        '<span class="nav-signin" style="font-size:12px;font-weight:500;">' + name + '</span>' +
        '</button>' +
        '<div id="jwlzDropdown" style="display:none;position:absolute;right:0;top:calc(100% + 8px);background:#fff;border-radius:12px;padding:8px;min-width:140px;box-shadow:0 8px 32px rgba(0,0,0,0.12);border:1px solid rgba(193,199,203,0.2);z-index:200;">' +
        '<button onclick="_jwlzSignOut()" style="width:100%;text-align:left;padding:10px 14px;border:none;background:none;font-family:\'Inter\',sans-serif;font-size:13px;color:#1b1c1c;cursor:pointer;border-radius:8px;" onmouseover="this.style.background=\'#f5f3f3\'" onmouseout="this.style.background=\'none\'">Sign Out</button>' +
        '</div></div>';
    } else {
      el.innerHTML = '<button onclick="_jwlzSignIn()" class="nav-signin" style="background:none;border:none;cursor:pointer;padding:8px 16px;">Sign In</button>';
    }
  });
}

_jwlzAuth.onAuthStateChanged(_jwlzRenderAuth);

window._jwlzSignIn = function() {
  _jwlzAuth.signInWithPopup(_jwlzProvider).catch(function(e) { console.error('Sign-in error', e); });
};
window._jwlzSignOut = function() {
  _jwlzAuth.signOut();
};
window._jwlzToggleMenu = function() {
  var d = document.getElementById('jwlzDropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
};

document.addEventListener('click', function(e) {
  var m = document.getElementById('jwlzUserMenu');
  if (m && !m.contains(e.target)) {
    var d = document.getElementById('jwlzDropdown');
    if (d) d.style.display = 'none';
  }
});

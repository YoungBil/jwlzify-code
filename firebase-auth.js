// REPLACE THESE VALUES WITH YOUR FIREBASE CONFIG
// Get them from: console.firebase.google.com
// Project Settings > General > Your Apps > SDK setup
var firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

var _auth     = firebase.auth();
var _provider = new firebase.auth.GoogleAuthProvider();

_auth.onAuthStateChanged(function(user) {
  var signInBtn  = document.getElementById('signInBtn');
  var userMenu   = document.getElementById('userMenu');
  var userAvatar = document.getElementById('userAvatar');
  var userName   = document.getElementById('userName');

  if (user) {
    if (signInBtn)  signInBtn.style.display  = 'none';
    if (userMenu)   userMenu.style.display   = 'flex';
    if (userAvatar) userAvatar.src = user.photoURL ||
      'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || 'U') + '&background=3c6474&color=fff';
    if (userName)   userName.textContent = (user.displayName || '').split(' ')[0] || 'Account';
  } else {
    if (signInBtn)  signInBtn.style.display  = 'block';
    if (userMenu)   userMenu.style.display   = 'none';
  }
});

window.signInWithGoogle = function() {
  _auth.signInWithPopup(_provider)
    .catch(function(err) { console.error('Sign in error:', err); });
};

window.signOut = function() {
  _auth.signOut();
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

// REPLACE THESE VALUES WITH YOUR FIREBASE CONFIG
// Get them from: console.firebase.google.com
// Project Settings > General > Your Apps > SDK setup
var firebaseConfig = {
  apiKey:            "AIzaSyAgE9VthaPufLzdU-H92NlJRx0iUuitHrY",
  authDomain:        "jwlzify.firebaseapp.com",
  projectId:         "jwlzify",
  storageBucket:     "jwlzify.firebasestorage.app",
  messagingSenderId: "885878261157",
  appId:             "1:885878261157:web:e6f16655b6a2875983144c"
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

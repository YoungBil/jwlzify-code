var firebaseConfig = {
  apiKey:            "AIzaSyAUzGJOBj7atcEX2XkS_LXpUs1wbWnWaV0",
  authDomain:        "jwlzify.firebaseapp.com",
  projectId:         "jwlzify",
  storageBucket:     "jwlzify.firebasestorage.app",
  messagingSenderId: "885878261157",
  appId:             "1:885878261157:web:e6f16655b6a2875983144c"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.signInWithGoogle = function() {
  const auth     = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then((result) => {
      console.log('Success:', result.user.displayName);
    })
    .catch((error) => {
      console.error('Error:', error.code, error.message);
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

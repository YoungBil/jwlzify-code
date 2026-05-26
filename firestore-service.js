// Requires firebase-app-compat, firebase-firestore-compat, firebase-auth-compat
(function() {
  function db() { return firebase.firestore(); }

  window.JWL = window.JWL || {};

  JWL.saveDesign = async function(data) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    try {
      const ref = await db()
        .collection('users').doc(user.uid)
        .collection('designs').add({
          ...data,
          uid: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      return ref.id;
    } catch (e) { console.error('saveDesign:', e); return null; }
  };

  JWL.saveOrder = async function(data) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    try {
      const ref = await db()
        .collection('users').doc(user.uid)
        .collection('orders').add({
          ...data,
          uid: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      return ref.id;
    } catch (e) { console.error('saveOrder:', e); return null; }
  };

  JWL.getDesigns = async function() {
    const user = firebase.auth().currentUser;
    if (!user) return [];
    try {
      const snap = await db()
        .collection('users').doc(user.uid)
        .collection('designs')
        .orderBy('createdAt', 'desc').limit(20).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('getDesigns:', e); return []; }
  };

  JWL.getOrders = async function() {
    const user = firebase.auth().currentUser;
    if (!user) return [];
    try {
      const snap = await db()
        .collection('users').doc(user.uid)
        .collection('orders')
        .orderBy('createdAt', 'desc').limit(20).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('getOrders:', e); return []; }
  };
})();

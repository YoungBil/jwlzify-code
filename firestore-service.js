import { getFirestore, collection, addDoc,
         query, orderBy, limit, getDocs,
         serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// _jwlApp is set synchronously by firebase-auth.js (also type="module", runs first)
const db = () => getFirestore(window._jwlApp);

window.JWL = window.JWL || {};

JWL.saveDesign = async function (data) {
  const user = window._jwlAuth?.currentUser;
  if (!user) return null;
  try {
    const ref = await addDoc(
      collection(db(), 'users', user.uid, 'designs'),
      { ...data, uid: user.uid, createdAt: serverTimestamp() }
    );
    return ref.id;
  } catch (e) { console.error('saveDesign:', e); return null; }
};

JWL.saveOrder = async function (data) {
  const user = window._jwlAuth?.currentUser;
  if (!user) return null;
  try {
    const ref = await addDoc(
      collection(db(), 'users', user.uid, 'orders'),
      { ...data, uid: user.uid, createdAt: serverTimestamp() }
    );
    return ref.id;
  } catch (e) { console.error('saveOrder:', e); return null; }
};

JWL.getDesigns = async function () {
  const user = window._jwlAuth?.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db(), 'users', user.uid, 'designs'),
            orderBy('createdAt', 'desc'), limit(20))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('getDesigns:', e); return []; }
};

JWL.getOrders = async function () {
  const user = window._jwlAuth?.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db(), 'users', user.uid, 'orders'),
            orderBy('createdAt', 'desc'), limit(20))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('getOrders:', e); return []; }
};

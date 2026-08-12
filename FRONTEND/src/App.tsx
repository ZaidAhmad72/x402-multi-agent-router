import { Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import ChatApp from './pages/ChatApp';
import Tutorial from './pages/Tutorial';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/user/:username" element={<ChatApp />} />
      <Route path="/tutorial" element={<Tutorial />} />
    </Routes>
  );
}

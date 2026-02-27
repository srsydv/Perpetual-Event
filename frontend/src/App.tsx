import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Market from "./pages/Market";
import CreateEvent from "./pages/CreateEvent";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/market/:eventId" element={<Market />} />
          <Route path="/create" element={<CreateEvent />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

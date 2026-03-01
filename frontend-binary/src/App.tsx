import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Market from "./pages/Market";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/market/:marketId" element={<Market />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

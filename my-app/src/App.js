import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Navbar from './Components/Navbar';
import Hero from './Components/HeroSection';
import Body from './Components/BodySection';
import Top from './Components/Top';
import Footer from './Components/Footer';
import Upload from './Components/UploadPage';
import RequireAuth from './Components/RequireAuth';
import Login from './Components/Login';
import ResetPassword from './Components/ResetPassword';
import AdminRoute from './Components/Admin/AdminRoute';
import { ToastProvider } from './Components/ToastContext';
import "./App.css";

function App() {
  return (                                      
    <BrowserRouter> 
      <ToastProvider>
        <Main />
      </ToastProvider>
    </BrowserRouter>
  );
}

function Main() {
  return (
    <Routes>
      <Route 
        path="/" 
        element={
          <>
            <Navbar />
            <Hero />
            <Body />
            <Top />
            <Footer />
          </>
        } 
      />
      
      <Route 
        path="/upload" 
        element={
          <RequireAuth>
            <>
              <Navbar />
              <Upload />
              <Footer />
            </>
          </RequireAuth>
        } 
      />

      <Route 
        path="/login"
        element={
          <>
            <Navbar />
            <Login />
            <Footer />
          </>
        }
      />
      
      <Route 
        path="/reset-password/:token"
        element={<ResetPassword />}
      />
      
      <Route 
        path="/admin" 
        element={<AdminRoute />} 
      />
    </Routes>
  );
}

export default App;

import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { configurado } from "./lib/supabase";
import { LayoutSupervisor, Protegido } from "./components/Layout";
import { Carregando } from "./components/ui";
const Login = lazy(() => import("./pages/Login"));
const Painel = lazy(() => import("./pages/Painel"));
const Remessas = lazy(() => import("./pages/Remessas"));
const NovaRemessa = lazy(() => import("./pages/NovaRemessa"));
const RemessaDetalhe = lazy(() => import("./pages/RemessaDetalhe"));
const Distribuicao = lazy(() => import("./pages/Distribuicao"));
const Conferencia = lazy(() => import("./pages/Conferencia"));
const LogBips = lazy(() => import("./pages/LogBips"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const Lojas = lazy(() => import("./pages/Lojas"));
const Separacao = lazy(() => import("./pages/Separacao"));
const Conferir = lazy(() => import("./pages/Conferir"));
const Estatisticas = lazy(() => import("./pages/Estatisticas"));

function Inicio() {
  const { carregando, perfil } = useAuth();
  if (carregando) return <Carregando />;
  if (!perfil) return <Navigate to="/login" replace />;
  return <Navigate to={perfil.papel === "supervisor" ? "/painel" : "/separacao"} replace />;
}

function SemConfiguracao() {
  return (
    <div className="mx-auto max-w-lg p-8 text-navy">
      <h1 className="text-xl font-semibold">Falta configurar o Supabase</h1>
      <p className="mt-2 text-sm text-suave">
        Crie o arquivo <code>.env.local</code> a partir do <code>.env.example</code> com{" "}
        <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {configurado ? (
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={<Carregando />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Inicio />} />
            <Route
              path="/separacao"
              element={
                <Protegido>
                  <Separacao />
                </Protegido>
              }
            />
            <Route
              path="/conferir"
              element={
                <Protegido>
                  <Conferir />
                </Protegido>
              }
            />
            <Route
              element={
                <Protegido supervisor>
                  <LayoutSupervisor />
                </Protegido>
              }
            >
              <Route path="/painel" element={<Painel />} />
              <Route path="/remessas" element={<Remessas />} />
              <Route path="/remessas/nova" element={<NovaRemessa />} />
              <Route path="/remessas/:id" element={<RemessaDetalhe />} />
              <Route path="/distribuicao" element={<Distribuicao />} />
              <Route path="/conferencia" element={<Conferencia />} />
              <Route path="/bips" element={<LogBips />} />
              <Route path="/estatisticas" element={<Estatisticas />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/lojas" element={<Lojas />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "Prompt" } }} />
      </AuthProvider>
    ) : (
      <SemConfiguracao />
    )}
  </StrictMode>,
);

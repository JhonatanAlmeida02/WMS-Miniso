import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { configurado } from "./lib/supabase";
import { LayoutLoja, LayoutSupervisor, LayoutVisualizador, Protegido } from "./components/Layout";
import { telaInicial } from "./lib/papeis";
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
const InicioOperador = lazy(() => import("./pages/InicioOperador"));
const Estatisticas = lazy(() => import("./pages/Estatisticas"));
const LojasMiniso = lazy(() => import("./pages/LojasMiniso"));
const PainelLoja = lazy(() => import("./pages/loja/PainelLoja"));
const PainelLojaSupervisor = lazy(() => import("./pages/loja/PainelLoja").then((m) => ({ default: m.PainelLojaSupervisor })));
const PedidoLoja = lazy(() => import("./pages/loja/PedidoLoja"));
const PedidoLojaSupervisor = lazy(() => import("./pages/loja/PedidoLoja").then((m) => ({ default: m.PedidoLojaSupervisor })));
const Entregas = lazy(() => import("./pages/loja/Entregas"));
const ConferirRecebimento = lazy(() => import("./pages/loja/ConferirRecebimento"));
const EquipeLoja = lazy(() => import("./pages/loja/Equipe"));
const InicioConferente = lazy(() => import("./pages/loja/InicioConferente"));
const VisaoRede = lazy(() => import("./pages/visao/VisaoRede"));
const VisaoLoja = lazy(() => import("./pages/visao/VisaoRede").then((m) => ({ default: m.VisaoLoja })));
const VisaoPedido = lazy(() => import("./pages/visao/VisaoRede").then((m) => ({ default: m.VisaoPedido })));

function Inicio() {
  const { carregando, perfil } = useAuth();
  if (carregando) return <Carregando />;
  if (!perfil) return <Navigate to="/login" replace />;
  return <Navigate to={telaInicial(perfil)} replace />;
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
              path="/inicio"
              element={
                <Protegido>
                  <InicioOperador />
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
              {/* Módulo das lojas (área separada da separação do CD) */}
              <Route path="/lojas-miniso" element={<LojasMiniso />} />
              <Route path="/lojas-miniso/loja/:lojaId" element={<PainelLojaSupervisor />} />
              <Route path="/lojas-miniso/loja/:lojaId/pedidos/:id" element={<PedidoLojaSupervisor />} />
              <Route path="/bips" element={<LogBips />} />
              <Route path="/estatisticas" element={<Estatisticas />} />
              {/* Cadastros: só owner e administrador */}
              <Route path="/usuarios" element={<Protegido admin><Usuarios /></Protegido>} />
              <Route path="/lojas" element={<Protegido admin><Lojas /></Protegido>} />
            </Route>
            {/* Visualizador: só leitura, no escopo de lojas da conta */}
            <Route
              element={
                <Protegido visualizador>
                  <LayoutVisualizador />
                </Protegido>
              }
            >
              <Route path="/visao" element={<VisaoRede />} />
              <Route path="/visao/loja/:lojaId" element={<VisaoLoja />} />
              <Route path="/visao/loja/:lojaId/pedidos/:id" element={<VisaoPedido />} />
            </Route>
            {/* Módulo das lojas: painel, entregas e equipe só para o administrador da loja */}
            <Route
              element={
                <Protegido loja adminLoja>
                  <LayoutLoja />
                </Protegido>
              }
            >
              <Route path="/loja" element={<PainelLoja />} />
              <Route path="/loja/pedidos/:id" element={<PedidoLoja />} />
              <Route path="/loja/entregas" element={<Entregas />} />
              <Route path="/loja/equipe" element={<EquipeLoja />} />
            </Route>
            {/* Conferente da loja: tela no modelo do operador, só com Conferir */}
            <Route
              path="/loja/inicio"
              element={
                <Protegido loja>
                  <InicioConferente />
                </Protegido>
              }
            />
            <Route
              path="/loja/conferir/:recebimento"
              element={
                <Protegido loja>
                  <ConferirRecebimento />
                </Protegido>
              }
            />
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

import SprintDashboard from "./SprintDashboard.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";

function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <SprintDashboard />
      <InstallPrompt />
    </div>
  );
}

export default App;

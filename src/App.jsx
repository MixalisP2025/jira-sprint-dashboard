import { UserButton } from "@clerk/clerk-react";
import SprintDashboard from "./SprintDashboard.jsx";

function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="absolute top-4 right-4 z-50">
        <UserButton afterSignOutUrl="/sign-in" />
      </div>
      <SprintDashboard />
    </div>
  );
}

export default App;

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET() {
  try {
    // Get PM2 status in JSON format
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);
    
    // Find our specific processes
    const backend = processes.find(p => p.name === 'jira-backend');
    const frontend = processes.find(p => p.name === 'jira-frontend');
    
    return new Response(
      JSON.stringify({ 
        success: true,
        backend: {
          status: backend?.pm2_env?.status || 'offline',
          uptime: backend?.pm2_env?.pm_uptime || null,
          restarts: backend?.pm2_env?.restart_time || 0,
          memory: backend?.monit?.memory || 0,
          cpu: backend?.monit?.cpu || 0
        },
        frontend: {
          status: frontend?.pm2_env?.status || 'offline',
          uptime: frontend?.pm2_env?.pm_uptime || null,
          restarts: frontend?.pm2_env?.restart_time || 0,
          memory: frontend?.monit?.memory || 0,
          cpu: frontend?.monit?.cpu || 0
        }
      }),
      { 
        status: 200,
        headers: { "content-type": "application/json" } 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        message: 'PM2 not available or no processes running',
        error: error.message 
      }),
      { 
        status: 500,
        headers: { "content-type": "application/json" } 
      }
    );
  }
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST() {
  try {
    // Restart all PM2 processes
    const { stdout, stderr } = await execAsync('pm2 restart all');
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Servers restarted successfully',
        output: stdout 
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
        message: 'Failed to restart servers',
        error: error.message 
      }),
      { 
        status: 500,
        headers: { "content-type": "application/json" } 
      }
    );
  }
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST() {
  try {
    // Start PM2 processes using the ecosystem config
    const { stdout, stderr } = await execAsync('npm run start:pm2');
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Servers started successfully',
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
        message: 'Failed to start servers',
        error: error.message 
      }),
      { 
        status: 500,
        headers: { "content-type": "application/json" } 
      }
    );
  }
}

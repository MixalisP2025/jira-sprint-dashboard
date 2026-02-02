// Helper to make authenticated API calls with Clerk token
export async function authenticatedFetch(url, options = {}, getToken) {
  const headers = { ...options.headers };
  
  // Add Clerk token if getToken function is provided
  if (getToken) {
    try {
      const token = await getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting auth token:', error);
    }
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

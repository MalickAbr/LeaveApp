const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'leave-data';
const BLOB_NAME = 'staff-leave-data.json';

app.http('SaveLeaveData', {
  methods: ['POST'],
  authLevel: 'anonymous', // Static Web Apps already enforces "authenticated" via routes config
  route: 'leave-data',
  handler: async (request, context) => {
    try {
      // Azure Static Web Apps injects this header for every authenticated request.
      // It's base64-encoded JSON containing the signed-in user's identity/claims.
      const principalHeader = request.headers.get('x-ms-client-principal');
      if (!principalHeader) {
        return { status: 401, jsonBody: { error: 'Not authenticated.' } };
      }

      const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
      // principal.userDetails = the signed-in user's email/username
      // We don't re-check Admin/Manager role here against the Excel data because the
      // Function has no knowledge of your staff list — that check already happened
      // client-side before this was called. This header check only confirms the
      // request truly came from someone who passed Entra sign-in, not a forged call.

      const body = await request.json();
      if (!body || !Array.isArray(body.data)) {
        return { status: 400, jsonBody: { error: 'Request body must be { data: [...] }' } };
      }

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return {
          status: 500,
          jsonBody: { error: 'Storage not configured. AZURE_STORAGE_CONNECTION_STRING is missing.' }
        };
      }

      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
      await containerClient.createIfNotExists();
      const blockBlobClient = containerClient.getBlockBlobClient(BLOB_NAME);

      const payload = JSON.stringify({
        data: body.data,
        lastUpdated: new Date().toISOString(),
        updatedBy: principal.userDetails
      });

      await blockBlobClient.upload(payload, Buffer.byteLength(payload), { overwrite: true });

      return {
        status: 200,
        jsonBody: { success: true, lastUpdated: new Date().toISOString() }
      };
    } catch (err) {
      context.error('SaveLeaveData failed:', err.message);
      return {
        status: 500,
        jsonBody: { error: 'Failed to save leave data.' }
      };
    }
  }
});

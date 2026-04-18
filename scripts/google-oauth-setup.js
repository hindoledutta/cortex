"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const readline = __importStar(require("readline"));
const google_auth_library_1 = require("google-auth-library");
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
async function main() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
        console.error('Create OAuth 2.0 credentials at: https://console.cloud.google.com/apis/credentials');
        process.exit(1);
    }
    const oauth2Client = new google_auth_library_1.OAuth2Client(clientId, clientSecret, REDIRECT_URI);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
    });
    console.log('\n=== Google Calendar OAuth2 Setup ===\n');
    console.log('1. Open this URL in your browser:\n');
    console.log(`   ${authUrl}\n`);
    console.log('2. Sign in and grant calendar access');
    console.log('3. Copy the authorization code and paste it below\n');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const code = await new Promise((resolve) => {
        rl.question('Authorization code: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
    if (!code) {
        console.error('ERROR: No authorization code provided');
        process.exit(1);
    }
    try {
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
            console.error('ERROR: No refresh token received. Make sure you used prompt: "consent" and access_type: "offline".');
            console.error('Try revoking access at https://myaccount.google.com/permissions and running again.');
            process.exit(1);
        }
        console.log('\n=== Success! ===\n');
        console.log('Add this to your .env file:\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        console.log('You can now use the Calendar Integration features in Cortex.');
    }
    catch (error) {
        console.error('ERROR: Failed to exchange authorization code for tokens');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
main();
//# sourceMappingURL=google-oauth-setup.js.map
const ROLES = Object.freeze({
  ADMIN: "admin",
  RECRUITER: "recruiter",
});

const MICROSOFT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const MICROSOFT_GET_TOKEN = "https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token"
const MICROSOFT_SEND_MAIL = "https://graph.microsoft.com/v1.0/users/<SENDER_EMAIL>/sendMail";

export { ROLES, MICROSOFT_GRAPH_SCOPE, MICROSOFT_GET_TOKEN, MICROSOFT_SEND_MAIL };

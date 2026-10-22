# Local Foundation Architecture

The local application has a React browser application, an Express API, and PostgreSQL. The browser shell does not yet consume registry data; the API exposes local server-registry routes and uses PostgreSQL migrations. No scheduler, MCP checker, AWS service, credentials, or external monitoring request is configured in the application at this stage.

```text
Browser -> React application -> Express API -> PostgreSQL
```

The intended later architecture remains conditional on Phase 0 verification:

```text
Browser -> frontend -> API and monitoring service -> PostgreSQL
                                      |
                                      -> confirmed remote MCP endpoint
```

# 官方文档章节索引

采集日期：2026-09-08。保留所读页面的全部标题层级；设计引用及结论见根目录 sources.md。

## S05 OAuth 2.0 安全最佳实践 RFC 9700

来源：https://www.rfc-editor.org/rfc/rfc9700.html

- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#rfcnum)
- [Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html#title)
  - [Abstract](https://www.rfc-editor.org/rfc/rfc9700.html#abstract)
  - [Status of This Memo](https://www.rfc-editor.org/rfc/rfc9700.html#name-status-of-this-memo)
  - [Copyright Notice](https://www.rfc-editor.org/rfc/rfc9700.html#name-copyright-notice)
  - [Table of Contents](https://www.rfc-editor.org/rfc/rfc9700.html#name-table-of-contents)
  - [1. Introduction](https://www.rfc-editor.org/rfc/rfc9700.html#name-introduction)
    - 1.1. Structure
    - 1.2. Conventions and Terminology
  - [2. Best Practices](https://www.rfc-editor.org/rfc/rfc9700.html#name-best-practices)
    - 2.1. Protecting Redirect-Based Flows
      - 2.1.1. Authorization Code Grant
      - 2.1.2. Implicit Grant
    - 2.2. Token Replay Prevention
      - 2.2.1. Access Tokens
      - 2.2.2. Refresh Tokens
    - 2.3. Access Token Privilege Restriction
    - 2.4. Resource Owner Password Credentials Grant
    - 2.5. Client Authentication
    - 2.6. Other Recommendations
  - [3. The Updated OAuth 2.0 Attacker Model](https://www.rfc-editor.org/rfc/rfc9700.html#name-the-updated-oauth-20-attack)
  - [4. Attacks and Mitigations](https://www.rfc-editor.org/rfc/rfc9700.html#name-attacks-and-mitigations)
    - 4.1. Insufficient Redirection URI Validation
      - 4.1.1. Redirect URI Validation Attacks on Authorization Code Grant
      - 4.1.2. Redirect URI Validation Attacks on Implicit Grant
      - 4.1.3. Countermeasures
    - 4.2. Credential Leakage via Referer Headers
      - 4.2.1. Leakage from the OAuth Client
      - 4.2.2. Leakage from the Authorization Server
      - 4.2.3. Consequences
      - 4.2.4. Countermeasures
    - 4.3. Credential Leakage via Browser History
      - 4.3.1. Authorization Code in Browser History
      - 4.3.2. Access Token in Browser History
    - 4.4. Mix-Up Attacks
      - 4.4.1. Attack Description
      - 4.4.2. Countermeasures
        - 4.4.2.1. Mix-Up Defense via Issuer Identification
        - 4.4.2.2. Mix-Up Defense via Distinct Redirect URIs
    - 4.5. Authorization Code Injection
      - 4.5.1. Attack Description
      - 4.5.2. Discussion
      - 4.5.3. Countermeasures
        - 4.5.3.1. PKCE
        - 4.5.3.2. Nonce
        - 4.5.3.3. Other Solutions
      - 4.5.4. Limitations
    - 4.6. Access Token Injection
      - 4.6.1. Countermeasures
    - 4.7. Cross-Site Request Forgery
      - 4.7.1. Countermeasures
    - 4.8. PKCE Downgrade Attack
      - 4.8.1. Attack Description
      - 4.8.2. Countermeasures
    - 4.9. Access Token Leakage at the Resource Server
      - 4.9.1. Access Token Phishing by Counterfeit Resource Server
      - 4.9.2. Compromised Resource Server
      - 4.9.3. Countermeasures
    - 4.10. Misuse of Stolen Access Tokens
      - 4.10.1. Sender-Constrained Access Tokens
      - 4.10.2. Audience-Restricted Access Tokens
      - 4.10.3. Discussion: Preventing Leakage via Metadata
    - 4.11. Open Redirection
      - 4.11.1. Client as Open Redirector
      - 4.11.2. Authorization Server as Open Redirector
    - 4.12. 307 Redirect
    - 4.13. TLS Terminating Reverse Proxies
    - 4.14. Refresh Token Protection
      - 4.14.1. Discussion
      - 4.14.2. Recommendations
    - 4.15. Client Impersonating Resource Owner
      - 4.15.1. Countermeasures
    - 4.16. Clickjacking
    - 4.17. Attacks on In-Browser Communication Flows
      - 4.17.1. Examples
        - 4.17.1.1. Insufficient Limitation of Receiver Origins
        - 4.17.1.2. Insufficient URI Validation
        - 4.17.1.3. Injection after Insufficient Validation of Sender Origin
      - 4.17.2. Recommendations
  - [5. IANA Considerations](https://www.rfc-editor.org/rfc/rfc9700.html#name-iana-considerations)
  - [6. Security Considerations](https://www.rfc-editor.org/rfc/rfc9700.html#name-security-considerations)
  - [7. References](https://www.rfc-editor.org/rfc/rfc9700.html#name-references)
    - 7.1. Normative References
    - 7.2. Informative References
  - [Acknowledgements](https://www.rfc-editor.org/rfc/rfc9700.html#name-acknowledgements)
  - [Authors' Addresses](https://www.rfc-editor.org/rfc/rfc9700.html#name-authors-addresses)

## S06 浏览器 Cookie

来源：https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies

- [Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
  - [In this article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
  - [What cookies are used for](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#what_cookies_are_used_for)
    - Data storage
  - [Creating, removing, and updating cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#creating_removing_and_updating_cookies)
    - Removal: defining the lifetime of a cookie
    - Updating cookie values
      - Updating cookies via JavaScript
  - [Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#security)
    - Block access to your cookies
    - Define where cookies are sent
    - Controlling third-party cookies with SameSite
    - Cookie prefixes
  - [Privacy and tracking](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#privacy_and_tracking)
  - [Cookie-related regulations](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#cookie-related_regulations)
  - [See also](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#see_also)
  - [Help improve MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#feedback)

## S07 浏览器 CORS

来源：https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

- [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
  - [In this article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
  - [What requests use CORS?](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#what_requests_use_cors)
  - [Functional overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#functional_overview)
  - [Examples of access control scenarios](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#examples_of_access_control_scenarios)
    - Simple requests
    - Preflighted requests
      - Preflighted requests and redirects
    - Requests with credentials
      - Preflight requests and credentials
      - Credentialed requests and wildcards
      - Third-party cookies
  - [The HTTP response headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#the_http_response_headers)
    - Access-Control-Allow-Origin
    - Access-Control-Expose-Headers
    - Access-Control-Max-Age
    - Access-Control-Allow-Credentials
    - Access-Control-Allow-Methods
    - Access-Control-Allow-Headers
  - [The HTTP request headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#the_http_request_headers)
    - Origin
    - Access-Control-Request-Method
    - Access-Control-Request-Headers
  - [Specifications](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#specifications)
  - [Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#browser_compatibility)
  - [See also](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#see_also)
  - [Help improve MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#feedback)

## S08 GitHub OAuth 授权

来源：https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

  - [Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#allproducts-menu)
- [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#title-h1)
  - [In this article](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#in-this-article)
  - [Expiring access tokens](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#expiring-access-tokens)
    - Opting in to expiring tokens at runtime
    - Requiring expiring tokens for your app
  - [Web application flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow)
    - 1. Request a user's GitHub identity
    - 2. Users are redirected back to your site by GitHub
    - 3. Use the access token to access the API
  - [Device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
    - Overview of the device flow
    - Step 1: App requests the device and user verification codes from GitHub
    - Step 2: Prompt the user to enter the user code in a browser
    - Step 3: App polls GitHub to check if the user authorized the device
    - Rate limits for the device flow
    - Error codes for the device flow
  - [Refreshing an access token with a refresh token](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token)
  - [Non-Web application flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#non-web-application-flow)
  - [Redirect URLs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#redirect-urls)
    - Loopback redirect urls
  - [Creating multiple tokens for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#creating-multiple-tokens-for-oauth-apps)
  - [Directing users to review their access](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#directing-users-to-review-their-access)
  - [Troubleshooting](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#troubleshooting)
  - [Further reading](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#further-reading)
  - [Help and support](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
    - Did you find what you needed?
    - Help us make these docs great!
    - Still need help?
  - [Legal](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

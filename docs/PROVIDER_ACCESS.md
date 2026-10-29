# Indeed and Glassdoor access policy

Reviewed 2026-10-29. No provider credentials or written authorization are present
in this repository. A public URL and a working third-party scraper do not establish
permission. This is an engineering access decision, not legal advice.

| Provider | Current decision | Evidence |
| --- | --- | --- |
| Indeed | Conditional public HTML only; verify robots before each uncached policy period | [Terms, Site Rules](https://www.indeed.com/legal?hl=en_US), updated September 29, 2026, conditionally permit crawling as outlined in robots.txt. [Robots](https://www.indeed.com/robots.txt) varies by path and query. |
| Glassdoor | Restricted by default; offer browser search without fetching listings | [Current terms](https://www.glassdoor.com/about/terms/), revised July 1, 2026, section 8 prohibits automated extraction without express written permission. [Robots](https://www.glassdoor.com/robots.txt) is an additional restriction, not authorization. |

Structured GraphQL/mobile/session endpoints are disabled: there is no documented
authorized contract. No alternate route is attempted after an access denial.
An embedding application may supply a source-specific access grant with a nonempty
documented evidence reference through the internal API; the CLI has no permission
bypass flag or environment toggle. Such a grant still cannot override robots,
HTTP blocks, login walls or challenges. Synthetic tests use explicit fixture grants.

Robots decisions expire after six hours and fail closed on malformed/unavailable
responses. Blocks have a separate cooldown (Retry-After or fifteen minutes), never
a successful empty-result cache. `jobs url --website Indeed Glassdoor --search ...`
remains available without network access. No live Glassdoor collection is authorized
or claimed. Reassess this policy if provider terms or written permissions change.

# Glassdoor public-access research

Checked 2026-10-27. Primary sources:

- [Public accountant search](https://www.glassdoor.com/Job/accountant-jobs-SRCH_KO0,10.htm)
- [Terms](https://www.glassdoor.com/about/terms/)
- [Robots rules](https://www.glassdoor.com/robots.txt)

The indexed public search exposes title, employer, location, salary labels, snippets
and posting links containing `jl`. It presents a “Show more jobs” control. This is
evidence of public presentation, not proof that Node requests work. Terms restrict
automated collection without permission; public visibility does not grant permission.
Robots rules disallow `_IP` pagination and several detail/API routes.

Implementation: Cheerio DOM cards plus JSON-LD JobPosting/ItemList/graph parsing.
Only keyword search is mapped to the observed public URL format. Location is a local
case-insensitive substring match. Company uses shared normalized equality; other
criteria require observed fields. No unverified server facets are claimed. Salary
labels retain employer/estimate attribution. Applicant counts and verification remain
unknown because reliable public components were not established.

Pagination follows public next anchors only, checks current robots rules, stops on
repeated posting IDs, and reports client-only loading or crawl restrictions. It never
uses GraphQL, hidden APIs or private location-ID lookup. A tiny open-source robots
parser was added to avoid implementing crawl-rule precedence by hand.

Live Node smoke check: HTTP 403 on 2026-10-27; stopped immediately without retries
or attempts to get around the restriction. Live Glassdoor extraction is **not
verified**. Synthetic fixtures test parser contracts, not captured live markup.

# App Store Connect answers

What Loba declares in App Store Connect, and why, so the answers stay in
sync with the code and `privacy.html`. Update this when data handling
changes, and re-check the App Privacy section in App Store Connect to match.

Last checked against the code: 2026-09-25 (build 1.0.0 (4)).

## App Privacy ("nutrition label")

**Do you or your third-party partners collect data from this app?** Yes.

**Tracking:** No data is used for tracking. There are no ads, analytics,
or crash-reporting SDKs, and no data is shared with data brokers.

| Data type (Apple's category) | What it is in Loba | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Sign-up email (Supabase Auth) | Yes | No | App Functionality |
| Location → Precise Location | GPS coordinates captured when posting, voting, or commenting | Yes | No | App Functionality |
| Location → Coarse Location | Region derived from the request IP, used to check a post's location is plausible (#43) | Yes | No | App Functionality |
| User Content → Other User Content | Posts, tags, comments, and reports | Yes | No | App Functionality |
| Identifiers → User ID | Account ID that posts, votes, and comments are stored against | Yes | No | App Functionality |
| Usage Data → Product Interaction | Up/down votes, stored per account to prevent double and self-voting | Yes | No | App Functionality |

Apple's "App Functionality" purpose explicitly covers fraud prevention and
security, which is why the IP-derived location and ban-evasion checks sit
there rather than under a separate purpose.

**Not collected:** Health, Financial, Contacts, Photos or Videos, Audio,
Browsing History, Search History, Purchases, Sensitive Info, Device ID,
Diagnostics (no crash or performance SDK).

## Age rating

Answer the questionnaire literally; App Store Connect computes the rating.

| Question | Answer | Why |
|---|---|---|
| Content descriptors (violence, sexual content, profanity, drugs, gambling, horror, medical, etc.) | None | Loba itself contains none of this. User content is covered by the capability below. |
| User-generated content | Yes | Anonymous public posts and comments |
| Messaging and chat | No | No private or direct messages; comments are public on a post |
| Unrestricted web access | No | No in-app browser to arbitrary sites |
| Advertising | No | |
| Parental controls / age assurance | No | |

**Consider raising the rating manually.** Anonymous, location-based
posting is the model where bullying around schools has been a problem for
similar apps. App Store Connect lets you choose a higher rating than the
computed one. The Terms currently set the minimum age at 13; if you raise
the App Store rating (e.g. to 18+), raise the Terms' minimum age to match.

## Listing URLs

| Field | Value |
|---|---|
| Support URL | https://arnoldson.github.io/loba/support.html |
| Privacy Policy URL | https://arnoldson.github.io/loba/privacy.html |
| Marketing URL | (optional, leave blank) |

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in `app.json`, so builds skip the
encryption questions. Loba only uses HTTPS provided by the OS.

---
'@medalsocial/booking': patch
---

A stored Reserve with Google referral dated more than five minutes ahead of the clock (the clock was corrected backward after capture) is no longer read, so it cannot outlive Google's 30-day window. The same token on the landing URL is captured again at the current time.

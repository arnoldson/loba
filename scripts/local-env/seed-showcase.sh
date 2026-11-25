#!/usr/bin/env bash
# Seeds the local stack with realistic-looking posts around central Seoul for
# portfolio screenshots and the walkthrough video (see README.md here).
#
#   scripts/local-env/seed-showcase.sh
#
# Local stack only. Creates six anonymous local accounts and writes posts,
# comments, vote counts and expiry times straight into the local database,
# so the feed shows a mix of ages, scores and time-left badges. Posts the
# viewer account made in a walkthrough are removed too. Every post
# sits on a public landmark; the simulated user is at Seoul City Hall
# (37.5665, 126.9780). Re-running replaces the previous showcase posts.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
case "$API_URL" in http://127.0.0.1:*) ;; *) echo "seed-showcase: refusing non-local $API_URL" >&2; exit 1 ;; esac

for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"showcase-$i@loba.local\",\"password\":\"local-capture-pass\",\"email_confirm\":true}"
done

docker exec -i supabase_db_loba psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
BEGIN;
-- Showcase posts, plus anything the viewer posted during a walkthrough.
DELETE FROM posts WHERE user_id IN (SELECT id FROM auth.users
  WHERE email LIKE 'showcase-%@loba.local' OR email = 'capture-viewer@loba.local');

CREATE TEMP TABLE authors AS
  SELECT id, row_number() OVER (ORDER BY email) AS n
  FROM auth.users WHERE email LIKE 'showcase-%@loba.local';

-- (author, content, lat, lng, minutes ago, minutes left, up, down)
CREATE TEMP TABLE seed (a int, content text, lat float8, lng float8, ago int, left_ int, up int, down int);
INSERT INTO seed VALUES
  -- Right by the user at City Hall plaza: the "nearby feed" sector.
  (1, 'Free outdoor yoga on the City Hall lawn tomorrow at 7am. Bring a mat! #yoga',            37.56655, 126.97795,  95, 1310, 24, 1),
  (2, 'Food truck by the plaza fountain has the best hotteok right now #food',                 37.56648, 126.97808,  22, 1418, 31, 2),
  (3, 'The ice rink setup has started on the plaza. Looks like it opens next week #winter',     37.56661, 126.97786, 400, 2290, 42, 0),
  (4, 'Lost a black umbrella near exit 5. If you find it, please leave it at the info desk',  37.56644, 126.97793,1140,  300,  5, 0),
  (5, 'Bus 402 is on a detour today, the stop moved one block north',                          37.56652, 126.97812,1395,   45, 12, 1),
  (6, 'Anyone know why there''s a line outside the library? #cityhall',                        37.56658, 126.97802,  48, 1392,  9, 0),

  -- Around the neighbourhood, for the zoomed-out map.
  (1, 'Night market stalls are setting up along Gwanghwamun Square #market',   37.57255, 126.97690, 130, 1310, 17, 0),
  (2, 'Changing of the guard at Gwanghwamun in 10 minutes',                    37.57290, 126.97680,  12, 1428, 11, 0),
  (3, 'Admiral Yi statue is lit up blue tonight, really pretty',               37.57120, 126.97700, 260, 1180,  8, 0),
  (4, 'Huge crowd at the square, some kind of festival #festival',             37.57180, 126.97720, 340, 1100, 21, 3),
  (5, 'Kyobo bookstore is packed, the reading tables are all taken',           37.57080, 126.97780, 600,  840,  6, 0),
  (6, 'Deoksugung wall walk at sunset is unreal today',                        37.56580, 126.97510, 180, 1260, 18, 0),
  (1, 'Free palace entry today for the holiday #deoksugung',                   37.56600, 126.97480, 520,  920, 26, 1),
  (2, 'Street musician near Daehanmun is amazing, go listen #music',           37.56540, 126.97560,  35, 1405, 14, 0),
  (3, 'Myeongdong street food is back in full swing #food',                    37.56370, 126.98600,  70, 1370, 33, 2),
  (4, 'Cosmetics stores are doing 1+1 deals all along the main street',        37.56340, 126.98560, 300, 1140,  7, 4),
  (5, 'Cathedral choir is rehearsing, you can hear it from the steps',         37.56330, 126.98710, 210, 1230, 15, 0),
  (6, 'Egg bread stand at the corner has no line right now',                   37.56410, 126.98520,  15, 1425, 10, 0),
  (1, 'Rain is about to start, grab an umbrella',                              37.56390, 126.98650, 230, 1210,  4, 1),
  (2, 'Insadong tea house has a garden seat open #tea',                        37.57400, 126.98560, 160, 1280, 12, 0),
  (3, 'Calligraphy demo happening in Ssamziegil courtyard',                    37.57440, 126.98500, 420, 1020,  9, 0),
  (4, 'The hotteok line here is shorter than the one on the main street',      37.57370, 126.98610,  60, 1380,  6, 0),
  (5, 'Lanterns are up along Cheonggyecheon already #lanterns',                37.56890, 126.98500, 110, 1330, 29, 0),
  (6, 'Stepping stones at Gwangtonggyo are open again after the rain',         37.56860, 126.98420, 480,  960,  8, 0),
  (1, 'Someone is feeding the ducks near the bridge, so many ducks',           37.56920, 126.98580, 290, 1150, 13, 0),
  (2, 'Late-night nogari spots in Euljiro filling up already #euljiro',        37.56620, 126.99180, 200, 1240, 22, 1),
  (3, 'Print shop alley has a pop-up gallery tonight',                         37.56650, 126.99100, 650,  790, 11, 0),
  (4, 'KTX delays at Seoul Station, check the boards before you go',          37.55470, 126.97070,  40, 1400, 16, 0),
  (5, 'The rooftop garden at Seoullo 7017 is surprisingly quiet',              37.55600, 126.97200, 330, 1110,  7, 0),
  (6, 'Namdaemun market knife sharpener is set up by gate 2',                  37.55910, 126.97750, 520,  920,  5, 0),
  (1, 'Galchi alley has a 30 min wait right now #food',                        37.55870, 126.97820, 150, 1290, 19, 1),
  (2, 'Bosingak bell ceremony at noon, worth seeing once',                     37.57010, 126.98300, 600,  840, 10, 0),
  (3, 'Jonggak station exit 1 escalator is out, use the stairs',               37.57050, 126.98250,  80, 1360,  6, 0),
  (4, 'Seosomun park is a great quiet spot to read #park',                     37.56300, 126.97000, 380, 1060,  8, 0);

CREATE TEMP TABLE inserted AS
WITH ins AS (
  INSERT INTO posts (user_id, content, latitude, longitude, tags, created_at, updated_at, expires_at, upvote_count, downvote_count)
  SELECT au.id, s.content, s.lat, s.lng,
         COALESCE((SELECT array_agg(DISTINCT lower(m[1])) FROM regexp_matches(s.content, '(#\w+)', 'g') AS m), '{}'),
         now() - make_interval(mins => s.ago), now() - make_interval(mins => s.ago),
         now() + make_interval(mins => s.left_), s.up, s.down
  FROM seed s JOIN authors au ON au.n = s.a
  RETURNING id, content
) SELECT * FROM ins;

-- A conversation on the yoga post and one on the ice rink post.
INSERT INTO comments (post_id, user_id, content, created_at)
SELECT p.id, au.id, c.content, now() - make_interval(mins => c.ago)
FROM (VALUES
  ('Free outdoor yoga%', 3, 'Is it still on if it rains?', 80),
  ('Free outdoor yoga%', 1, 'They said it moves inside the library lobby if it rains', 74),
  ('Free outdoor yoga%', 5, 'See you there!', 30),
  ('The ice rink setup%', 2, 'Last year it opened mid December, so this is early', 300),
  ('The ice rink setup%', 6, 'Skate rental was 1,000 won last year, best deal in the city', 210)
) AS c(pattern, a, content, ago)
JOIN inserted p ON p.content LIKE c.pattern
JOIN authors au ON au.n = c.a;

COMMIT;
SELECT count(*) AS showcase_posts FROM inserted;
SQL

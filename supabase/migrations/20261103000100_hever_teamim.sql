-- "לאן יוצאים": the places in Be'er Sheva that honor the "חבר טעמים" card
-- (Hever's loadable restaurant card: 20%-30% off when it is loaded), each
-- with a keva card deal everyone sees. Places to sit only.
--
-- The list is Hever's store locator, exported by hand (the site needs a login
-- and turns automated requests away) and turned into the rows below by
-- scripts/hever-to-sql.py, which also explains the hours conversion. To
-- refresh it, run the script on a new export into a new migration.
--
-- A place already in the catalog (same normalized name within 150 m) only
-- gets the deal and the details it lacks; the others are added with source
-- 'hever', which the weekly OSM load leaves alone. Should OSM add one of them
-- later, the list shows it twice until an admin hides one. Safe to run again.

alter table public.venues
  drop constraint venues_source_check,
  add constraint venues_source_check check (source in ('osm', 'community', 'hever'));

create temporary table hever (
  name text not null,
  kind text not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  phone text,
  website text,
  opening_hours text,
  cuisine text,
  note text,
  venue_id bigint
);

insert into hever (name, kind, lat, lng, address, phone, website, opening_hours, cuisine, note) values
  ('קפה קפה', 'cafe', 31.252307, 34.769776, 'גרנד קניון שדרות טוביהו 125', '08-9918698', 'https://www.cafecafe.co.il/he/home/a/main', 'Su-Th 08:00-22:30; Fr "08:00-שעתיים לכניסת שבת"; Sa "מוצ״ש - 23:00"', 'בית קפה; חלבי; כשר מהדרין', null),
  ('Black', 'restaurant', 31.224418, 34.801447, 'ברוך קנטיקי 2', '072-3940247', 'https://blackbarburger.co.il', 'Su-Th "12:00-לקוח אחרון"; Fr "12:00-לקוח אחרון"; Sa "12:00-לקוח אחרון"', 'בשרים; כשר', null),
  ('Siesata', 'cafe', 31.243261, 34.812207, 'חייל ההנדסה 1/5', '08-6650334', 'https://www.rol.co.il/sites/siesta', 'Su-Th 07:30-23:00; Fr 07:30-23:00; Sa 09:00-23:00', 'בית קפה', 'בישיבה בלבד · לא כולל Take away'),
  ('בוצ''רי', 'restaurant', 31.238132, 34.787564, 'ההסתדרות 22', '08-6233370', null, 'Su-Th 12:00-23:00; Fr "12:00-שעתיים לפני כניסת שבת"; Sa "מצאת השבת - 23:30"', 'בשרים; דגים; ים תיכוני; כשר', null),
  ('קפה קפה', 'cafe', 31.224413, 34.801423, 'ברוך קטינקא 2', '08-6379939', 'https://www.cafecafe.co.il/he/home/a/main/', 'Su-Th 09:00-23:00; Fr 07:30-23:30; Sa 09:00-23:30', 'בית קפה; בשרים', null),
  ('freshop', 'cafe', 31.244257, 34.796932, 'תחנה מרכזית באר שבע', null, 'https://sahoot.co.il/', 'Su-Th 09:00-22:00; Fr 09:00-16:00; Sa "מצאת השבת-23:00"', 'מתוקים-קינוחים; צמחוני-טבעוני', null),
  ('Mr pretzel', 'restaurant', 31.244246, 34.810619, 'קניון הנגב באר שבע', '1-700-501-037', 'https://www.mrpretzels.co.il', 'Su-Th 09:30-21:30; Fr 09:30-15:00; Sa "חצי שעה מצאת השבת - 23:00"', 'מתוקים-קינוחים; כשר', null),
  ('קפה קפה', 'cafe', 31.244269, 34.810611, 'אליהו נאוי 21', '08-6607870', 'https://www.cafecafe.co.il', 'Su-Th 08:30-00:00; Fr 08:00-15:00; Sa "שעה לאח צאת השבת - 00:00"', 'איטלקי; בית קפה; חלבי; כריכים-סלטים', null),
  ('בורגראנץ''', 'restaurant', 31.239481, 34.773663, 'נווה זאב, שד'' יוהנה ז''בוטינסקי 30', '1-700-700-600', null, 'Su-Th 11:00-22:00; Fr 11:00-14:30; Sa "שעה אחרי צאת שבת – 23:00"', 'בשרים; מהדרין', null),
  ('בורגראנץ''', 'restaurant', 31.252584, 34.768614, 'גרנד קניון, שד'' דוד טוביהו 125', '1-700-700-600', null, 'Su-Th 11:00-22:00; Fr 11:00-15:00; Sa 18:30-23:00', 'בשרים; כשר', null),
  ('בורגראנץ''', 'restaurant', 31.243857, 34.809777, 'מ. ביג, דרך חברון 21', '1-700-700-600', null, 'Su-Th 11:00-22:00; Fr 11:00-15:00; Sa "שעה אחרי צאת שבת – 22:00"', 'בשרים; כשר', null),
  ('בורגראנץ''', 'restaurant', 31.24423, 34.792259, 'קניון הנגב, צומת אלי כהן', '1-700-700-600', null, 'Su-Th 09:00-21:30; Fr 09:00-14:30; Sa 08:30-21:30', 'בשרים; מהדרין', null),
  ('ג''סיקה', 'restaurant', 31.246144, 34.812032, 'יצחק נפחא 25', '054-9788827', 'https://jessica-restro-bar.co.il', 'Su-Th 12:00-00:30; Fr 12:00-00:30; Sa 12:00-00:30', 'בשרים; ים תיכוני; מזרחי', null),
  ('Roasters', 'cafe', 31.25456, 34.79751, 'יעקב כהן 12', '08-9178282', null, 'Su-Th 07:00-23:00; Fr 07:00-13:30; Sa 18:00-23:00', 'בר-פאב; בית קפה; בהשגחת יצהר', null),
  ('גלידה GOLDA', 'cafe', 31.258944, 34.796201, 'ראובן רובין 7 מתחם הבלוק', '08-6445959', 'https://www.goldaglida.co.il', null, 'מתוקים-קינוחים', null),
  ('קפה גרג', 'cafe', 31.251269, 34.77224, 'שדרות דוד טוביהו 125', '052-70444411', 'https://gregcafe.co.il/', 'Su-Th 09:00-22:00; Fr 08:30-15:00; Sa unknown', 'בית קפה; כריכים-סלטים; מתוקים-קינוחים; כשר בד"ץ', null),
  ('בובו המבורגר', 'restaurant', 31.24339, 34.795899, 'שמריהו לוין 3', '08-6414000', 'https://boboburgers.co.il', 'Su-Th 10:00-02:00; Fr unknown; Sa "חצי שעה מצאת השבת - 23:00"', 'בשרים; כשר', null),
  ('פיצה סטורי', 'restaurant', 31.253437, 34.771058, 'דרך מצדה 266', '3606*', 'https://pizza-story.co.il', 'Su-Th 11:00-23:00; Fr 10:00-15:00; Sa "חצי שעה מצאת השבת - 23:00"', 'חלבי; כשר', null),
  ('פיצה סטורי', 'restaurant', 31.253033, 34.804132, 'רחוב דרך השלום 31, שכונה ג''', '08-6222110', 'https://pizza-story.co.il', 'Su-Th 11:00-23:00; Fr unknown; Sa "חצי שעה מצאת השבת - 23:30"', 'חלבי; כשר', null),
  ('sweetime', 'cafe', 31.24314, 34.81327, 'מרכז ביג - המשק 3', '08-6199933', null, 'Su-Th 09:00-22:00; Fr 09:00-15:00; Sa 11:00-23:00', 'מתוקים-קינוחים', null),
  ('פיצה רומא', 'restaurant', 31.255415, 34.80775, 'גוש עציון 22', '08-6316161', null, 'Su-Th 10:00-00:00; Fr 10:00-15:00; Sa "חצי שעה מצאת השבת - 00:00"', 'איטלקי; חלבי; צמחוני-טבעוני; כשר למהדרין', null),
  ('פיצה רומא', 'restaurant', 31.2308, 34.767169, 'אפרים לרון 112', '08-6316161', 'https://www.romab7.chipit.co.il', 'Su-Th 10:00-00:00; Fr 10:00-15:00; Sa "חצי שעה מצאת השבת - 00:00"', 'איטלקי; חלבי; צמחוני-טבעוני; כשר למהדרין', null),
  ('אושי אושי', 'restaurant', 31.243753, 34.794653, 'שד'' יצחק רגר 2', '08-6118888', null, 'Su-We 10:00-23:00; Th 10:00-00:00; Fr "10:00- שעה לפני כניסת שבת"; Sa "חצי שעה מצאת השבת - 00:00"', 'סושי-אסייאתי; צמחוני-טבעוני; כשר בהשגחת הרבנות ב"ש', null),
  ('בית הפול', 'restaurant', 31.238604, 34.774083, 'יהונה זבוטינסקי 11', '077-7876969', null, 'Su-Th 09:00-22:00; Fr 09:00-14:30; Sa unknown', 'ים תיכוני; צמחוני-טבעוני; כשר', null),
  ('בית הפול', 'restaurant', 31.244488, 34.811406, 'ביג באר שבע', '08-6368090', null, 'Su-Th 10:00-20:30; Fr 10:00-14:30; Sa unknown', 'ים תיכוני; צמחוני-טבעוני; כשר', null),
  ('גלידה באר שבע', 'cafe', 31.240607, 34.79072, 'הדסה 50', '08-6814555', null, 'Su-Th 10:00-23:00; Fr 10:00-17:00; Sa 10:30-23:30', 'מתוקים-קינוחים', null),
  ('גלידה באר שבע', 'cafe', 31.251358, 34.769298, 'גרנד קניון', '08-6814555', null, 'Su-Th 10:00-23:00; Fr 10:00-17:00; Sa 10:30-23:30', 'מתוקים-קינוחים', null),
  ('בליקר בייקרי', 'restaurant', 31.250968, 34.771845, 'גרנד קניון', null, null, 'Su-Th 09:00-22:00; Mo 09:00-22:30; Fr 08:00-15:00; Sa 19:00-00:00', 'איטלקי; בית קפה; כשר', null),
  ('הספריה', 'restaurant', 31.246089, 34.812048, 'יצחק נפחא 25', '08-6655120', null, 'Su-Th 12:00-23:00; Fr 12:00-23:00; Sa 12:00-23:00', 'בשרים', 'כולל ארוחות עסקיות'),
  ('קאמפיי', 'restaurant', 31.244371, 34.811303, 'חיל ההנדסה 1', '08-6655999', null, 'Su-We 12:00-00:00; Th 12:00-00:30; Fr 12:00-00:30; Sa 12:00-00:30', 'סושי-אסייאתי', 'כולל עסקיות'),
  ('קפאסה', 'restaurant', 31.244335, 34.812537, 'חיל ההנדסה 6', '08-6655122', null, 'Su-We 12:00-23:00; Th 12:00-00:00; Fr 12:00-23:00; Sa 12:00-00:00', 'ים תיכוני', 'כולל עסקיות'),
  ('kampai street wok', 'restaurant', 31.243998, 34.811964, 'חיל ההנדסה 1', '6288*', null, 'Su-Th unknown; Fr 11:00-14:30; Sa "שעה מצאת השבת - 23:00"', 'סושי-אסייאתי; כשר', 'כולל ארוחות עסקיות, לא כולל כפל חברי מועדון'),
  ('KOH THAI', 'restaurant', 31.23726, 34.787386, 'סמילנסקי 23', '08-6654854', null, 'Su-Th unknown; Fr unknown; Sa "שעה לאחר צאת שבת - 00:00"', 'סושי-אסייאתי; כשר', 'כולל ארוחות עסקיות, לא כולל כפל חברי מועדון'),
  ('CHI CHI', 'bar', 31.242102, 34.810291, 'חיל ההנדסה 1', '050-024440', null, 'Su-Th unknown; Fr 19:00-00:30; Sa 19:30-00:30', 'סושי-אסייאתי; בר-פאב', 'כולל ארוחות עסקיות, לא כולל כפל חברי מועדון'),
  ('דומינו''ס פיצה', 'restaurant', 31.237938, 34.794296, 'דרך חברון 4', null, 'https://www.dominos.co.il', null, 'איטלקי; חלבי', 'הזמנות יתבצעו באפליקציה ואתר ההזמנות'),
  ('דומינו''ס פיצה', 'restaurant', 31.263373, 34.810923, 'רחוב האנרגיה 77', null, 'https://www.dominos.co.il', null, 'איטלקי; חלבי', 'הזמנות יתבצעו באפליקציה ואתר ההזמנות'),
  ('בנדיקט', 'restaurant', 31.243207, 34.81367, 'המשק 1 מתחם ביג', '03-686-8657', null, 'Su-Th 08:00-23:00; Fr 08:00-23:00; Sa 08:00-23:00', 'בית קפה; חלבי; כריכים-סלטים; מתוקים-קינוחים', null),
  ('לה פטיסייר', 'cafe', 31.249353, 34.782372, 'חוגלה 25', '050-7992909', null, 'Su-Th 08:30-19:00; Fr 08:00-14:00; Sa unknown', 'בית קפה; חלבי; מתוקים-קינוחים', null),
  ('ביגה', 'restaurant', 31.250194, 34.772785, 'שדרות טוביהו דוד 126', '086385991', 'https://biga-bakery.co.il', 'Su-Th 09:00-21:30; Fr 08:00-14:00; Sa unknown', 'בית קפה; חלבי; כריכים-סלטים; כשר', null),
  ('פיטמאסטר', 'restaurant', 31.238586, 34.787244, 'הרצל 12', null, 'https://pitmaster.show', 'Su-We 20:00-23:00; Th 18:00-21:00; Fr unknown; Sa 21:15-00:15', 'בשרים; כשר', 'הזמנת שולחן מראש בלבד באתר'),
  ('חומוס אליהו', 'restaurant', 31.258967, 34.795809, 'דרך מצדה 6', '077-4015344', null, 'Su-Th 10:30-20:00; Fr 10:00-15:00; Sa unknown', 'ים תיכוני; מזרחי; בדץ בית יוסף', null),
  ('חומוס אליהו', 'restaurant', 31.245677, 34.781414, 'שדרות ירושלים 2 שכונה ט''', '08-9246661', null, 'Su-Th 10:30-21:30; Fr 09:30-14:30; Sa unknown', 'ים תיכוני; מזרחי; כשר למהדרין', null),
  ('לה פטיסייר', 'cafe', 31.28101, 34.804733, 'נחום שריג 3', null, null, 'Su-Th 08:30-19:00; Fr 08:00-14:00; Sa unknown', 'בית קפה; מתוקים-קינוחים; צמחוני-טבעוני', null),
  ('קפה ללוש', 'restaurant', 31.234048, 34.799462, 'החיטה 1 סינמה סיטי', '08-6237337', null, 'Su-Th 08:30-23:30; Fr "08:15 - שעה לפני כניסת שבת"; Sa "חצי שעה לאחר צאת שבת-23:30"', 'איטלקי; בית קפה; חלבי; כריכים-סלטים; מתוקים-קינוחים; כשר', null),
  ('מקדונלד''ס', 'restaurant', 31.234178, 34.799308, 'החיטה 1', null, 'https://www.mcdonalds.co.il', null, 'בשרים', null),
  ('מקדונלד''ס', 'restaurant', 31.250668, 34.772017, 'שדרות דוד טוביהו 125', null, 'https://www.mcdonalds.co.il', null, 'בשרים; כשר', null),
  ('מקדונלד''ס', 'restaurant', 31.244301, 34.791993, 'צומת אלי כהן', null, 'https://www.mcdonalds.co.il', null, 'בשרים; כשר', null),
  ('מקדונלד''ס', 'restaurant', 31.244002, 34.813784, 'דרך חברון 21', null, 'https://www.mcdonalds.co.il', null, 'בשרים', null),
  ('מקדונלד''ס', 'restaurant', 31.224104, 34.801413, 'ברוך קטינקא 2', null, 'https://www.mcdonalds.co.il', null, 'בשרים', null),
  ('מקדונלד''ס', 'restaurant', 31.243232, 34.796046, 'שמריהו לוין 4', null, 'https://www.mcdonalds.co.il', null, 'בשרים; כשר', null),
  ('מקדונלד''ס', 'restaurant', 31.246833, 34.812337, 'יצחק נפחא 25', null, 'https://www.mcdonalds.co.il', null, 'בשרים; כשר', null),
  ('בורגראנץ''', 'restaurant', 31.250808, 34.771762, 'גראנד קניון', '1700-700-600', null, 'Su-Th 11:00-22:00; Fr 11:00-15:30; Sa "חצי שעה מצאת השבת -23:00"', 'בשרים', null),
  ('freshop', 'cafe', 31.24367, 34.794913, 'קניון הנגב', '072-3341827', null, 'Su-Th 09:00-22:00; Fr 09:00-16:00; Sa 17:45-23:00', 'מתוקים-קינוחים; צמחוני-טבעוני', null),
  ('נוטלה אקספיריינס', 'cafe', 31.234085, 34.799548, 'סינמה סיטי באר שבע', '053-9281117', null, 'Su-We 09:00-22:00; Th 09:00-23:00; Fr 09:00-14:30; Sa 18:30-00:00', 'בית קפה; מתוקים-קינוחים', null),
  ('בורגרים', 'restaurant', 31.267797, 34.80824, 'הדעת 6', '4999*', 'https://www.iburgerim.co.il', null, 'בשרים; כשר בשר חלק', null),
  ('בורגרים', 'restaurant', 31.23783, 34.79222, 'בית האשל 21', '4999*', 'https://www.iburgerim.co.il', null, 'בשרים; כשר בשר חלק', null),
  ('לה גופרה', 'cafe', 31.23835, 34.773873, 'שדרות יוהנה זבוטינסקי 13', '08-6737788', null, 'Su-Th 10:00-23:00; Fr 09:00-15:00; Sa unknown', 'מתוקים-קינוחים; כשר למהדרין', null),
  ('בית הפול', 'restaurant', 31.251225, 34.772243, 'שדרות טוביהו 125', '08-9332677', null, 'Su-Th 10:00-22:00; Fr 09:30-15:30; Sa unknown', 'בשרים; ים תיכוני; צמחוני-טבעוני; כשר', null),
  ('LUGER', 'restaurant', 31.262315, 34.811574, 'חלקיקי האור 16', '08-6100195', null, 'Su-Th 12:00-23:00; Fr 12:00-23:00; Sa 12:00-23:00', 'בשרים', null),
  ('בית הפול', 'restaurant', 31.226182, 34.809798, 'הבדיל 17', '08-6370333', null, 'Su-Th 09:00-16:30; Fr 09:00-14:30; Sa unknown', 'מזרחי; צמחוני-טבעוני; כשר', null)
;

-- The catalog's own entry for it, if any: the nearest with the same name.
update hever h set venue_id = (
  select v.id
  from public.venues v
  where v.status = 'approved' and not v.hidden and v.lat is not null
    and public.norm_name(v.name) = public.norm_name(h.name)
    and sqrt(power((v.lat - h.lat) * 111195, 2) + power((v.lng - h.lng) * 111195 * cos(radians(h.lat)), 2)) < 150
  order by power(v.lat - h.lat, 2) + power(v.lng - h.lng, 2)
  limit 1
);

update public.venues v set
  phone = coalesce(v.phone, h.phone),
  website = coalesce(v.website, h.website),
  opening_hours = coalesce(v.opening_hours, h.opening_hours),
  cuisine = coalesce(v.cuisine, h.cuisine)
from hever h
where h.venue_id = v.id
  and (v.phone, v.website, v.opening_hours, v.cuisine) is distinct from
      (coalesce(v.phone, h.phone), coalesce(v.website, h.website),
       coalesce(v.opening_hours, h.opening_hours), coalesce(v.cuisine, h.cuisine));

with added as (
  insert into public.venues
    (name, kind, lat, lng, address, phone, website, opening_hours, cuisine, source, status, household_id, created_by)
  select name, kind, lat, lng, address, phone, website, opening_hours, cuisine, 'hever', 'approved', null, null
  from hever
  where venue_id is null
  returning id, name, lat, lng
)
update hever h set venue_id = a.id
from added a
where h.venue_id is null and h.name = a.name and h.lat = a.lat and h.lng = a.lng;

insert into public.venue_deals (venue_id, household_id, created_by, title, kind, note, status)
select distinct on (h.venue_id)
  h.venue_id, null::uuid, null::uuid, 'מכבדים חבר טעמים', 'member_card',
  left(concat_ws(' · ', 'בטעינת הכרטיס: 20%–30% הנחה', h.note), 200), 'approved'
from hever h
where not exists (
  select 1 from public.venue_deals d
  where d.venue_id = h.venue_id and d.kind = 'member_card' and d.title = 'מכבדים חבר טעמים'
);

drop table hever;

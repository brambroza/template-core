-- How the company writes numbers on screen and on paper (ข้อมูลบริษัท → รูปแบบตัวเลข):
-- thousands comma, decimals of money and decimals of quantities. Money and quantities are numeric(18,4), hence 0–4.
alter table company_profiles
  add column number_comma boolean not null default true,
  add column money_decimals smallint not null default 2 check (money_decimals between 0 and 4),
  add column qty_decimals smallint not null default 2 check (qty_decimals between 0 and 4);

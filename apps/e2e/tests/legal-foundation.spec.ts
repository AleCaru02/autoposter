import { expect, test } from '@playwright/test';

for(const [path,title]of [['/privacy','Privacy Policy'],['/termini','Termini e Condizioni'],['/cookie-policy','Cookie Policy']] as const){test(`${path} exposes the legal foundation and review warning`,async({page})=>{await page.goto(path);await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();await expect(page.getByText('DA REVISIONARE PRIMA DEL LANCIO COMMERCIALE')).toBeVisible();await expect(page.locator('meta[name="description"]')).toHaveAttribute('content',/.+/);});}

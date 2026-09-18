import { describe, expect, it } from "vitest";

import {
  findBroaderDomainProperty,
  isDomainProperty,
  pickPreferredSite,
  siteUrlHost,
} from "@/lib/seo/search-console";

/**
 * Une propriété de préfixe d'URL ne mesure que l'hôte exact qu'elle nomme.
 * Le site répondant à la fois sur meribeautystudio.com et sur www, choisir la
 * mauvaise fait disparaître du trafic des rapports sans le moindre message
 * d'erreur : les chiffres sont simplement plus bas, ce qui est le pire mode
 * de défaillance possible. Ces contrats verrouillent la détection de ce cas.
 */
describe("siteUrlHost", () => {
  it("lit l'hôte des deux formes de propriété", () => {
    expect(siteUrlHost("sc-domain:meribeautystudio.com")).toBe("meribeautystudio.com");
    expect(siteUrlHost("https://meribeautystudio.com/")).toBe("meribeautystudio.com");
  });

  it("ramène www au domaine nu, sinon les deux formes ne se compareraient jamais", () => {
    expect(siteUrlHost("https://www.meribeautystudio.com/")).toBe("meribeautystudio.com");
    expect(siteUrlHost("sc-domain:www.meribeautystudio.com")).toBe("meribeautystudio.com");
  });

  it("renvoie une chaîne vide sur une valeur illisible plutôt que de lever", () => {
    expect(siteUrlHost("")).toBe("");
    expect(siteUrlHost(null)).toBe("");
    expect(siteUrlHost("pas une url")).toBe("");
  });
});

describe("isDomainProperty", () => {
  it("distingue les deux types", () => {
    expect(isDomainProperty("sc-domain:meribeautystudio.com")).toBe(true);
    expect(isDomainProperty("https://meribeautystudio.com/")).toBe(false);
  });
});

describe("findBroaderDomainProperty", () => {
  const sites = [
    { siteUrl: "https://meribeautystudio.com/" },
    { siteUrl: "sc-domain:meribeautystudio.com" },
  ];

  it("signale la propriété de domaine quand un préfixe est sélectionné", () => {
    expect(findBroaderDomainProperty("https://meribeautystudio.com/", sites)).toBe(
      "sc-domain:meribeautystudio.com"
    );
  });

  it("ne signale rien quand la propriété de domaine est déjà celle choisie", () => {
    expect(findBroaderDomainProperty("sc-domain:meribeautystudio.com", sites)).toBeNull();
  });

  it("ne signale rien si la propriété de domaine n'existe pas", () => {
    expect(
      findBroaderDomainProperty("https://meribeautystudio.com/", [
        { siteUrl: "https://meribeautystudio.com/" },
      ])
    ).toBeNull();
  });

  it("ne confond pas deux domaines différents", () => {
    expect(
      findBroaderDomainProperty("https://meribeautystudio.com/", [
        { siteUrl: "sc-domain:exemple.com" },
      ])
    ).toBeNull();
  });

  it("tolère une liste absente", () => {
    expect(findBroaderDomainProperty("https://meribeautystudio.com/", undefined)).toBeNull();
  });
});

describe("pickPreferredSite", () => {
  const sites = [
    { siteUrl: "https://meribeautystudio.com/" },
    { siteUrl: "sc-domain:meribeautystudio.com" },
  ];

  it("respecte un choix explicite encore accessible", () => {
    expect(pickPreferredSite(sites, "https://meribeautystudio.com/")).toBe(
      "https://meribeautystudio.com/"
    );
  });

  it("préfère la propriété de domaine quand le choix configuré est inaccessible", () => {
    expect(pickPreferredSite(sites, "https://autre-site.com/")).toBe(
      "sc-domain:meribeautystudio.com"
    );
  });

  it("préfère la propriété de domaine quand rien n'est configuré", () => {
    expect(pickPreferredSite(sites, undefined)).toBe("sc-domain:meribeautystudio.com");
  });

  it("retombe sur la première propriété accessible faute de mieux", () => {
    expect(pickPreferredSite([{ siteUrl: "https://autre-site.com/" }], undefined)).toBe(
      "https://autre-site.com/"
    );
  });

  it("conserve la valeur configurée quand le compte n'a accès à rien", () => {
    expect(pickPreferredSite([], "sc-domain:meribeautystudio.com")).toBe(
      "sc-domain:meribeautystudio.com"
    );
  });
});

import { CUBE_VIEW, GAME_STATE_CHANGE, MAIN_VIEW } from "../../types/module-types/hs-gamestate-types";
import { HSElementHooker } from "../hs-core/hs-elementhooker";
import { HSGameState } from "../hs-core/hs-gamestate";
import { HSLogger } from "../hs-core/hs-logger";
import { HSModule } from "../hs-core/module/hs-module";
import { HSModuleManager } from "../hs-core/module/hs-module-manager";
import { HSSetting } from "../hs-core/settings/hs-setting";
import { HSSettings } from "../hs-core/settings/hs-settings";
import { HSShadowDOM } from "../hs-core/hs-shadowdom";
import { HSUI } from "../hs-core/hs-ui";
import { HSUtils } from "../hs-utils/hs-utils";
import { HSModuleOptions } from "../../types/hs-types";

/*
    Class: HSHepteracts
    IsExplicitHSModule: Yes
    Description: 
        Hypersynergism module which implements the following QoL functionalities:
            - In-game hepteract ratio display
            - "Quick expand and max" functionality when the user clicks one of the hepteract icons
            - "Quick expand and max" hepteract cost protection, 
              which won't let the user quick expand a hepteract if it would cost too much
    Author: Swiffy
*/
export class HSHepteracts extends HSModule {
    #heptGrid? : Element;
    #hepteractCraftTexts?: HTMLDivElement;

    #hepteractBaseNames = [
        'chronos',
        'hyperrealism',
        'quark',
        'challenge',
        'abyss',
        'accelerator',
        'acceleratorBoost',
        'multiplier'
    ];

    #hepteracts : string[] = [];
    #hepteractMeters: string[] = [];

    #boxCounts = {
        chronosHepteract: 0,
        hyperrealismHepteract: 0,
        quarkHepteract: 0,
        challengeHepteract: 0,
        abyssHepteract: 0,
        acceleratorHepteract: 0,
        acceleratorBoostHepteract: 0,
        multiplierHepteract: 0
    };

    // Current inventory (left side of the "x / y" meter), the cap is in #boxCounts
    #boxBalances : { [key: string]: number } = {};

    // Per-unit craft costs, mirrored from the game's Hepteracts.ts (HEPTERACT_CONVERSION / OTHER_CONVERSIONS).
    // Everything except quarks is multiplied by the singularity "Hepteract Costs" debuff.
    #craftCostTable : { [key: string]: { baseCap: number; hepteracts: number; others: { name: string; amount: number; scaled: boolean }[] } } = {
        chronosHepteract: { baseCap: 1000, hepteracts: 1e4, others: [{ name: 'Obtainium', amount: 1e115, scaled: true }] },
        hyperrealismHepteract: { baseCap: 1000, hepteracts: 1e4, others: [{ name: 'Offerings', amount: 1e80, scaled: true }] },
        quarkHepteract: { baseCap: 1000, hepteracts: 1e4, others: [{ name: 'Quarks', amount: 100, scaled: false }] },
        challengeHepteract: { baseCap: 1000, hepteracts: 5e4, others: [{ name: 'Platonic Cubes', amount: 1e11, scaled: true }, { name: 'Cubes', amount: 1e22, scaled: true }] },
        abyssHepteract: { baseCap: 1, hepteracts: 1e8, others: [{ name: 'Wow! Cubes', amount: 69, scaled: true }] },
        acceleratorHepteract: { baseCap: 1000, hepteracts: 1e5, others: [{ name: 'Tesseracts', amount: 1e14, scaled: true }] },
        acceleratorBoostHepteract: { baseCap: 1000, hepteracts: 2e5, others: [{ name: 'Hypercubes', amount: 1e10, scaled: true }] },
        multiplierHepteract: { baseCap: 1000, hepteracts: 3e5, others: [{ name: 'Obtainium', amount: 1e130, scaled: true }] }
    };

    // Singularity "Hepteract Costs" debuff, derived from a parsed per-unit hepteract cost
    #craftCostMulti? : number;

    #hepteractCosts : { [key: string]: number | null } = {
        chronosHepteract: null,
        hyperrealismHepteract: null,
        quarkHepteract: 100,
        challengeHepteract: null,
        abyssHepteract: null,
        acceleratorHepteract: null,
        acceleratorBoostHepteract: null,
        multiplierHepteract: null
    }; 

    #hyperToChallengeRatio = 0;
    #chronosToChallengeRatio = 0;
    #boostToMultiplierRatio = 0;
    #acceleratorToMultiplierRatio = 0;
    #chronosToAcceleratorRatio = 0;

    #ratioElementHtml = `
        <div id="hs-ratio-container">
            <div class="hs-ratio" id="hs-ratio-a">CHR/HYP/CHL: 1 / 123 / 123</div>
            <div class="hs-ratio" id="hs-ratio-b">ACC/BST/MLT: 1 / 123 / 123</div>
            <div class="hs-ratio" id="hs-ratio-c">CHR/ACC: 1 / 123</div>
        </div>`;
    
    #ratioElementStyle = `
        #hs-ratio-container {
            width: 100%;
            display: grid;
            justify-items: center;
            grid-template-columns: repeat(3, 1fr);
            grid-template-rows: 1fr;
            grid-column-gap: 0px;
            grid-row-gap: 0px;
        }`;

    #ratioElementA?: HTMLElement;
    #ratioElementB?: HTMLElement;
    #ratioElementC?: HTMLElement;

    #hepteractForgeView?: HTMLElement;
    #ownedHepteractsElement?: HTMLElement;
    #ownedHepteracts?: number;
    #ownedHepteractsWatch?: string;

    // Quick expand is expected to be spam clicked
    // We need to make sure that hepteract expansion + max goes through
    // and owned hepteracts value is updated before quick expand can be done again
    // Otherwise the hepteract quick expand cost protection might not trigger right
    #expandPending = false;
    #watchUpdatePending = false;

    constructor(moduleOptions : HSModuleOptions) {
        super(moduleOptions);

        this.#hepteracts = this.#hepteractBaseNames.map(h => {
            return `${h}Hepteract`;
        });

        this.#hepteractMeters = this.#hepteractBaseNames.map(h => {
            return `${h}ProgressBarText`;
        });
    }

    async init(): Promise<void> {
        const self = this;

        HSLogger.log("Initialising HSHepteracts module", this.context);

        const gameStateMod = HSModuleManager.getModule<HSGameState>('HSGameState');

        if(gameStateMod) {
            gameStateMod.subscribeGameStateChange("MAIN_VIEW", (prevView, currentView) => {
                if(prevView.getId() === MAIN_VIEW.CUBES && 
                    currentView.getId() !== MAIN_VIEW.CUBES && 
                    gameStateMod.getCurrentUIView("CUBE_VIEW").getId() === CUBE_VIEW.HEPTERACT_FORGE
                ) {
                    if(self.#ownedHepteractsWatch) {
                        HSLogger.debug("Hepteract forge view closed, stopping watch", this.context);
                        HSElementHooker.stopWatching(self.#ownedHepteractsWatch);
                    }
                } 
            });

            gameStateMod.subscribeGameStateChange("CUBE_VIEW", async (prevView, currentView) => {
                if(currentView.getId() === CUBE_VIEW.HEPTERACT_FORGE) {
                    HSLogger.debug("Hepteract forge view opened, starting watch", this.context);
                    self.#ownedHepteractsElement = await HSElementHooker.HookElement('#hepteractQuantity') as HTMLElement;

                    // Sets up a watch to watch for changes in the element which shows owned hepteracts amount
                    self.#ownedHepteractsWatch = HSElementHooker.watchElement(self.#ownedHepteractsElement, (value) => {
                        try {
                            const hepts = parseFloat(HSUtils.unfuckNumericString(value));
                            self.#ownedHepteracts = hepts;
                        } catch (e) {
                            HSLogger.error(`Failed to parse owned hepteracts`, self.context);
                        }

                        self.#watchUpdatePending = false;
                    }, 
                    {
                        greedy: true,
                        overrideThrottle: true,
                        valueParser: (element) => {
                            const subElement = element.querySelector('span');
                            const value = subElement?.innerText;
                            return value;
                        }
                    });
                } else if(prevView.getId() === CUBE_VIEW.HEPTERACT_FORGE) {
                    if(self.#ownedHepteractsWatch) {
                        HSLogger.debug("Hepteract forge view closed, stopping watch", this.context);
                        HSElementHooker.stopWatching(self.#ownedHepteractsWatch);
                    }
                }
            });
        }

        this.#heptGrid = await HSElementHooker.HookElement('#heptGrid');
        this.#hepteractCraftTexts = await HSElementHooker.HookElement('#hepteractCraftTexts') as HTMLDivElement;

        this.#heptGrid.childNodes.forEach(node => {
            if(node.nodeType === 1) {
                const htmlNode = node as HTMLElement;
                const id = htmlNode.id

                if(self.#hepteracts.includes(id)) {
                    const craftMaxBtn = document.querySelector(`#${id}CraftMax`) as HTMLElement;
                    const capBtn = document.querySelector(`#${id}Cap`) as HTMLElement;
                    const heptImg = document.querySelector(`#${id}Image`) as HTMLElement;

                    // As hepteract costs are not static and we don't have direct access to them, we need to parse them from the DOM in a "just-in-time" manner...
                    htmlNode.addEventListener('mouseenter', async (e: MouseEvent) => {

                        if(id in self.#hepteractCosts && id === 'quarkHepteract') {
                            return;
                        }

                        const costElement = document.querySelector('#hepteractCostText') as HTMLDivElement;

                        if(costElement) {
                            const costString = costElement.innerText;
                            const costMatch = costString.match(/you\s+(.*?)\s+Hepteracts/i);

                            if(costMatch) {
                                const cost = costMatch[1];
                                
                                try {
                                    if(id in self.#hepteractCosts) {
                                        const floatCost = parseFloat(HSUtils.unfuckNumericString(cost));
                                        (self.#hepteractCosts as any)[id] = floatCost;
                                    }
                                } catch (e) {
                                    HSLogger.warn(`Error while parsing hepteract cost for ${id}`, self.context);
                                }
                            }
                        }
                    });
                    
                    if(craftMaxBtn && capBtn && heptImg) {

                        // Render the total resource cost of "expand + max" when hovering over the image
                        heptImg.addEventListener('mouseenter', async () => {
                            // Give the game a moment to render this hepteract's cost text before reading it
                            await HSUtils.wait(25);
                            self.#parseCraftCost(id);
                            self.#renderExpandMaxCost(id);
                        });

                        heptImg.addEventListener('click', async (evt) => {
                            const target = evt.target as HTMLImageElement;
                            const targetId = target.id;
                            const isQuarkHepteract = targetId.toLowerCase().includes('quark');

                            if(!targetId) return;

                            // Don't allow quick expand on quark hepteract
                            if(isQuarkHepteract) return;

                            if(self.#expandPending || self.#watchUpdatePending) {
                                HSLogger.debug(`Quick expand cancelled, another expand was still pending (exp ${self.#expandPending}, wtch: ${self.#watchUpdatePending})`, self.context);
                                //self.#expandPending = false;
                                return;
                            }

                            self.#expandPending = true;
                            //self.#watchUpdatePending = true;

                            // The owned amount watch only starts when the forge view is opened, so it's never set
                            // if the mod was loaded while already on the forge. Read the current value directly instead.
                            self.#refreshOwnedHepteracts();

                            let buyCost = null;

                            let percentHeptOwned = null;
                            //let percentObtOwned = null;
                            //let percentOfferingOwned = null;

                            if(self.#ownedHepteracts !== null && self.#ownedHepteracts !== undefined) {
                                if(self.#ownedHepteracts === 0) {
                                    HSLogger.info(`Owned hepteracts is 0`, this.context);
                                    self.#expandPending = false;
                                    return;
                                }

                                const currentMax = (self.#boxCounts as any)[id];
                                const cubeCost = (self.#hepteractCosts as any)[id];

                                if(!(currentMax > 0) || !(cubeCost > 0)) {
                                    // Without a known cap and cost the protection can't be evaluated (buyCost would be 0 or NaN
                                    // and silently pass the check), so refuse to expand rather than expand blind
                                    HSLogger.warn(`Hepteract cap or cost for ${id} not parsed yet, hover the hepteract and try again`, self.context);
                                    self.#expandPending = false;
                                    return;
                                }

                                let hepteractDoubleCapSetting = HSSettings.getSetting('expandCostProtectionDoubleCap') as HSSetting<boolean>;
                                let nextHepts = null;

                                if(hepteractDoubleCapSetting.getValue()) {
                                    nextHepts = ((currentMax * 2) /*- currentMax*/)
                                    buyCost = ((currentMax * 2) /*- currentMax*/) * cubeCost;
                                } else {
                                    nextHepts = currentMax * 2;
                                    buyCost = currentMax * 2 * cubeCost;
                                }

                                percentHeptOwned = self.#ownedHepteracts > 0 ? buyCost / self.#ownedHepteracts : 1;

                                /*const obtHolder = await HSElementHooker.HookElement('#obtainiumDisplay') as HTMLElement;
                                const offeringHolder = await HSElementHooker.HookElement('#offeringDisplay') as HTMLElement;

                                if(obtHolder && offeringHolder) {
                                    const obtText = obtHolder.innerText;
                                    const offeringText = offeringHolder.innerText;

                                    if(obtText && offeringText) {
                                        const obtValue = parseFloat(HSUtils.unfuckNumericString(obtHolder.innerText));
                                        const offeringValue = parseFloat(HSUtils.unfuckNumericString(offeringHolder.innerText));

                                        percentObtOwned = ;
                                        percentOfferingOwned = ;
                                    }
                                }*/

                                HSLogger.debug(`
                                    Current max: ${currentMax},
                                    Cube cost: ${HSUtils.N(cubeCost)},
                                    Next hepts: ${HSUtils.N(nextHepts)},
                                    Buy cost: ${HSUtils.N(buyCost)},
                                    Percent owned: ${HSUtils.N(percentHeptOwned)},
                                    Double Cap: ${hepteractDoubleCapSetting.getValue()}`,
                                    this.context
                                );

                                const expandCostProtectionSetting = HSSettings.getSetting('expandCostProtection') as HSSetting<number>;
                                //const expandCostProtectionObtainiumSetting = HSSettings.getSetting('expandCostProtectionObtainium') as HSSetting<number>;
                                //const expandCostProtectionOfferingSetting = HSSettings.getSetting('expandCostProtectionOffering') as HSSetting<number>;
                                const costProtectionNotificationSetting = HSSettings.getSetting('expandCostProtectionNotifications') as HSSetting<boolean>;

                                const notify = (costProtectionNotificationSetting && costProtectionNotificationSetting.getValue() === true) ? false : true;

                                if(expandCostProtectionSetting.isEnabled()) {
                                    const heptSettingValue = expandCostProtectionSetting.getCalculatedValue();

                                    if(heptSettingValue && (percentHeptOwned >= heptSettingValue)) {
                                        if(notify)
                                            HSLogger.info(`Hept. cost protection: Cost owned ${HSUtils.N(percentHeptOwned * 100)}% >= ${heptSettingValue * 100}%`, this.context);
    
                                        //self.#watchUpdatePending = false;
                                        self.#expandPending = false;
                                        return;
                                    }
                                }

                                /*if(expandCostProtectionObtainiumSetting.isEnabled()) {
                                    const obtSettingValue = expandCostProtectionObtainiumSetting.getCalculatedValue();

                                    if(obtSettingValue && percentObtOwned >= obtSettingValue) {
                                        if(notify)
                                            HSLogger.info(`Obt. cost protection: ${percentObtOwned.toFixed(2)} >= ${obtSettingValue}`, this.context);
    
                                        self.#watchUpdatePending = false;
                                        self.#expandPending = false;
                                        return;
                                    }
                                }

                                if(expandCostProtectionOfferingSetting.isEnabled()) {
                                    const offeringSettingValue = expandCostProtectionOfferingSetting.getCalculatedValue();

                                    if(offeringSettingValue && percentOfferingOwned >= offeringSettingValue) {
                                        if(notify)
                                            HSLogger.info(`Off. cost protection: ${percentOfferingOwned.toFixed(2)} >= ${offeringSettingValue}`, this.context);
    
                                        self.#watchUpdatePending = false;
                                        self.#expandPending = false;
                                        return;
                                    }
                                }*/
                            } else {
                                HSLogger.warn(`Owned hepteracts not parsed yet`, this.context);

                                self.#watchUpdatePending = false;
                                self.#expandPending = false;
                                return;
                            }
                            
                            // This is the small "ON/OFF" toggle button which is used to enable/disable the hepteract buy notifications
                            const hepteractBuyNotificationToggle = await HSElementHooker.HookElement('#toggle35') as HTMLButtonElement;

                            if(hepteractBuyNotificationToggle && hepteractBuyNotificationToggle.innerText.includes('ON')) {
                                HSLogger.info(`Turned hepteract notification toggle OFF`, this.context);
                                hepteractBuyNotificationToggle.click();
                            }

                            // Perform our cap- and max button clicking
                            await HSUtils.hiddenAction(async () => {
                                capBtn.click();
                            }, "confirm", false, 25);

                            await HSUtils.wait(25);
                            
                            craftMaxBtn.click();

                            await HSUtils.wait(5);

                            if(id !== 'quarkHepteract') {
                                const costElement = document.querySelector('#hepteractCostText') as HTMLDivElement;
        
                                if(costElement) {
                                    const costString = costElement.innerText;
                                    const costMatch = costString.match(/you\s+(.*?)\s+Hepteracts/i);
        
                                    if(costMatch) {
                                        const cost = costMatch[1];
                                        
                                        try {
                                            if(id in self.#hepteractCosts) {
                                                const floatCost = parseFloat(HSUtils.unfuckNumericString(cost));
                                                (self.#hepteractCosts as any)[id] = floatCost;
                                            }
                                        } catch (e) {
                                            HSLogger.warn(`Error while parsing NEW hepteract cost for ${id}`, self.context);
                                        }
                                    }
                                }
                            }
                           
                            self.#refreshOwnedHepteracts();

                            self.#expandPending = false;

                            // Show what the next expand + max would cost once the meters have caught up
                            await HSUtils.wait(50);
                            self.#renderExpandMaxCost(id);
                        });
                    }
                }
            }
        });

        if(document.querySelectorAll('.heptTypeImage').length > 0) {
            HSUI.injectStyle(`
                .heptTypeImage:not(#quarkHepteractImage):not(#hepteractToQuarkImage):not(#overfluxPowderImage) {
                    transform: scale(1);
                    transform-origin: 50% 50%;
                }

                .heptTypeImage:not(#quarkHepteractImage):not(#hepteractToQuarkImage):not(#overfluxPowderImage):hover {
                    transform: scale(1.05);
                    cursor: pointer;
                }

                .heptTypeImage:not(#quarkHepteractImage):not(#hepteractToQuarkImage):not(#overfluxPowderImage):active {
                    transform: scale(0.98);
                }
            `);
        }

        

        HSLogger.log("Hepteract images now serve as 'quick expand and max' buttons", this.context);
        HSLogger.log("Setting up hepteract ratio watch", this.context);

        HSUI.injectStyle(this.#ratioElementStyle);

        HSUI.injectHTMLString(this.#ratioElementHtml, (node) => {
            const heptGridParent = self.#heptGrid?.parentNode;
            heptGridParent?.insertBefore(node, self.#heptGrid as Node);
        });

        this.#ratioElementA = document.querySelector('#hs-ratio-a') as HTMLElement;
        this.#ratioElementB = document.querySelector('#hs-ratio-b') as HTMLElement;
        this.#ratioElementC = document.querySelector('#hs-ratio-c') as HTMLElement;

        this.#hepteractMeters.forEach(meterId => {
            const meter = document.querySelector(`#${meterId}`) as HTMLElement;
            const boxName = meterId.substring(0, meterId.indexOf('ProgressBar')) + 'Hepteract';

            if(meter && boxName) {
                HSElementHooker.watchElement(meter, (value) => {
                    if(boxName in self.#boxCounts) {
                        (self.#boxCounts as any)[boxName] = value;
                        
                        if(Object.values(self.#boxCounts).every(v => v > 0)) {
                            self.#chronosToChallengeRatio = Math.round(self.#boxCounts.chronosHepteract / self.#boxCounts.challengeHepteract);
                            self.#hyperToChallengeRatio = Math.round(self.#boxCounts.hyperrealismHepteract / self.#boxCounts.challengeHepteract);
                            self.#acceleratorToMultiplierRatio = Math.round(self.#boxCounts.acceleratorHepteract / self.#boxCounts.multiplierHepteract);
                            self.#boostToMultiplierRatio = Math.round(self.#boxCounts.acceleratorBoostHepteract / self.#boxCounts.multiplierHepteract);
                            self.#chronosToAcceleratorRatio = Math.round(self.#boxCounts.chronosHepteract / self.#boxCounts.acceleratorHepteract);

                            if(this.#ratioElementA && this.#ratioElementB && this.#ratioElementC) {
                                this.#ratioElementA.innerText = `CHR/HYP/CHL: ${HSUtils.N(self.#chronosToChallengeRatio, 0)} / ${HSUtils.N(self.#hyperToChallengeRatio, 0)} / 1`;
                                this.#ratioElementB.innerText = `ACC/BST/MLT: ${HSUtils.N(self.#acceleratorToMultiplierRatio, 0)} / ${HSUtils.N(self.#boostToMultiplierRatio, 0)} / 1`;
                                this.#ratioElementC.innerText = `CHR/ACC: ${HSUtils.N(self.#chronosToAcceleratorRatio, 0)} / 1`;
                            }
                        }
                    } else {
                        HSLogger.warn(`Key ${boxName} not found in #boxCounts`, self.context);
                    }
                }, 
                {
                    valueParser: (element) => {
                        const value = element.innerText;
    
                        if(typeof value === 'string') {
                            const split = value.split('/');
    
                            try {
                                if(split && split[1]) {
                                    self.#boxBalances[boxName] = parseFloat(HSUtils.unfuckNumericString(split[0]));
                                    return parseFloat(HSUtils.unfuckNumericString(split[1]));
                                }
                            } catch (e) {
                                HSLogger.warn(`Parsing failed for ${split}`, self.context);
                                return '';
                            }
                        }
                        return '';
                    }
                });
            } else {
                HSLogger.warn(`Invalid meter or boxName`, self.context);
            }
        });

        this.isInitialized = true;
    }

    // Not used yet, but might be useful in the future
    #getHepteractCost(hepteractId: string): { cost: number; percentOwned: number } | undefined {
        const costObj: { cost: number; percentOwned: number } = {
            cost: 0,
            percentOwned: 0
        }

        if(this.#ownedHepteracts !== null && this.#ownedHepteracts !== undefined) {
            if(this.#ownedHepteracts === 0) {
                HSLogger.info(`Owned hepteracts is 0`, this.context);
                return undefined;
            }

            const currentMax = (this.#boxCounts as any)[hepteractId];
            const cubeCost = (this.#hepteractCosts as any)[hepteractId];

            if(currentMax === null || cubeCost === null) {
                HSLogger.warn(`Hepteract cost for ${hepteractId} not parsed yet`, this.context);
                return undefined;
            };

            let hepteractDoubleCapSetting = HSSettings.getSetting('expandCostProtectionDoubleCap') as HSSetting<boolean>;
            let buyCost = null;

            if(hepteractDoubleCapSetting.getValue()) {
                buyCost = currentMax * cubeCost;
            } else {
                buyCost = currentMax * 2 * cubeCost;
            }

            const percentOwned = this.#ownedHepteracts > 0 ? buyCost / this.#ownedHepteracts : 1;

            return {
                cost: buyCost,
                percentOwned: percentOwned
            }
        } else {
            HSLogger.warn(`Owned hepteracts not parsed yet`, this.context);
            return undefined;
        }
    }

    // Reads the per-unit hepteract cost from the game's cost text ("One of these will cost you X Hepteracts and ...")
    // and derives the craft cost multiplier from it, which applies to all hepteract types
    #parseCraftCost(hepteractId: string) {
        const costElement = document.querySelector('#hepteractCostText') as HTMLDivElement;
        const costMatch = costElement?.innerText.match(/you\s+(.*?)\s+Hepteracts/i);
        const table = this.#craftCostTable[hepteractId];

        if(!costMatch || !table) return;

        const perUnit = parseFloat(HSUtils.unfuckNumericString(costMatch[1]));

        if(perUnit > 0) {
            if(hepteractId !== 'quarkHepteract')
                this.#hepteractCosts[hepteractId] = perUnit;

            this.#craftCostMulti = perUnit / table.hepteracts;
        }
    }

    // Reads the owned hepteracts ("You possess X Hepteracts") straight from the DOM
    #refreshOwnedHepteracts() {
        const ownedElement = this.#ownedHepteractsElement ?? document.querySelector('#hepteractQuantity') as HTMLElement;
        const value = ownedElement?.querySelector('span')?.innerText;

        if(value) {
            const hepts = parseFloat(HSUtils.unfuckNumericString(value));

            if(!isNaN(hepts))
                this.#ownedHepteracts = hepts;
        }
    }

    // Mirrors the game: expanding needs a full (base cap) inventory, removes one base cap worth of
    // hepteracts and doubles the cap, after which "max" crafts the inventory up to the new cap
    #renderExpandMaxCost(hepteractId: string) {
        this.#refreshOwnedHepteracts();

        const table = this.#craftCostTable[hepteractId];
        const cap = (this.#boxCounts as any)[hepteractId] as number;
        const balance = this.#boxBalances[hepteractId];
        const multi = this.#craftCostMulti;

        let text: string;

        if(!table || !(cap > 0) || balance === undefined || !(multi && multi > 0)) {
            text = 'Expand + max cost: not parsed yet, hover again in a moment';
        } else {
            const doubleCap = (HSSettings.getSetting('expandCostProtectionDoubleCap') as HSSetting<boolean>).getValue();
            const capMultiplier = doubleCap ? 2 : 1;

            // The meter only shows ~3 significant digits ("2,04e6" for 2 048 000), but caps are always
            // BASE_CAP * 2^n (times 2 with double capacity), so snap the parsed cap to the exact value
            const unit = table.baseCap * capMultiplier;
            const exactCap = unit * Math.pow(2, Math.max(0, Math.round(Math.log2(cap / unit))));
            const baseCap = exactCap / capMultiplier;

            // Same rounding applies to the balance, treat anything within display precision of a threshold as reaching it
            const tolerance = 0.995;
            const exactBalance = balance >= exactCap * tolerance ? exactCap : balance;
            const canExpand = exactBalance >= baseCap * tolerance;

            const units = canExpand
                ? exactCap * 2 - Math.max(0, exactBalance - baseCap)
                : exactCap - exactBalance;

            const heptCost = units * table.hepteracts * multi;
            const owned = this.#ownedHepteracts;
            const ownedInfo = owned && owned > 0
                ? ` (${HSUtils.N(heptCost / owned * 100)}% of owned${heptCost > owned ? ', NOT ENOUGH' : ''})`
                : '';

            const others = table.others
                .map(o => `${HSUtils.N(units * o.amount * (o.scaled ? multi : 1))} ${o.name}`)
                .join(', ');

            text = canExpand
                ? `Expand + max: ${HSUtils.N(units, 0, 3)} crafts, costs ${HSUtils.N(heptCost)} Hepteracts${ownedInfo}, ${others}`
                : `Can't expand yet (${HSUtils.N(balance, 0)} / ${HSUtils.N(baseCap, 0)} needed). Max only: ${HSUtils.N(units, 0, 3)} crafts, costs ${HSUtils.N(heptCost)} Hepteracts${ownedInfo}, ${others}`;
        }

        if(this.#hepteractCraftTexts) {
            let costText = this.#hepteractCraftTexts.querySelector('#hs-costText') as HTMLDivElement;

            if(!costText) {
                costText = document.createElement('div');
                costText.id = 'hs-costText';
                this.#hepteractCraftTexts.appendChild(costText);
            }

            costText.innerText = `[${this.context}]: ${text}`;
        }
    }
}

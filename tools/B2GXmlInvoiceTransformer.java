//#***************************************************************************
//# freenet Technologie und Prozesse Source File: B2GXmlInvoiceTransformer.java
//# Copyright (c) 1996-2022 by freenet DLS GmbH
//# All rights reserved.
//#***************************************************************************

package de.mobilcom.transform.billoutput;

import static java.math.RoundingMode.HALF_UP;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.Map.Entry;
import java.util.TreeMap;

import org.jdom2.Document;
import org.jdom2.Element;
import org.jdom2.output.Format;
import org.jdom2.output.XMLOutputter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import de.mobilcom.framework.amount.Percentage;
import de.mobilcom.framework.amount.Price;
import de.mobilcom.framework.amount.PriceFormat;
import de.mobilcom.transform.AtomicOutputResult;
import de.mobilcom.transform.OutputResult;
import de.mobilcom.transform.TransformException;
import de.mobilcom.transform.TransformNotAllowedException;


/**
 * Transformiert 4-stellige Beträge in 2-stellig, berechnet die Subtotals und Total-Berträge 2-stellig.
 * Vergleicht die Differenzen zwischen den originals und abgerundeten und berechnet die Korrekturbeträge je
 * Steuersatz. Diese Korrekturbeträge werden dann an die DIFF_VAT je Steuersatz angerechnet, damit das Gesamt
 * Brutto der original Rechnung und der abgerundeten gleich waren. Existier nach der Brutto-Korrektur noch
 * eine Netto-Different, wird diese in den DIFF_VAT unter dem Steuersatz = 0% angerechnet, damit im Endeffekt
 * die Total -Beträge mit den Original zusammenstimmen. Die berechneten Korrekturbeträge werden anschlieÃend
 * als Kinder-Elemente in das neu erstellte Tag DOCUMENT_LEVEL_CHARGES geschrieben.
 *
 * @author sergej
 */
public class B2GXmlInvoiceTransformer extends XmlInvoiceTransformer
{

	private static final Logger LOGGER = LoggerFactory.getLogger(B2GXmlInvoiceTransformer.class);

	// private static final String
	private static final int B2G_INVOICE_PRECISION = 2;
	private static final int BILL_TOTALNET_VAT_CALCULATE_PRECISION = 6;
	private static final String LINE_SEPARATOR = System.lineSeparator();
	private static final String XML_PROCESSOR_LINE = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>" + LINE_SEPARATOR;
	private static final String ZERO_PAYMENT_TYPE = "ZERO";
	private static final String SEPA_PAYMENT_TYPE = "SEPADEBIT";
	private static final String ACH_SAVINGS_CREDITS = "ACH_SAVINGS_CREDITS";

	// Original (4-stellige) Netto-Preise je Umsatzsteuer
	private Map<Percentage, Price> originalPrices = new TreeMap<>();

	// Auf 2 Stellen abgerundete Netto-Preise je Umsatzsteuer
	private Map<Percentage, Price> roundupPrices = new TreeMap<>();

	private Map<Percentage, Price> documentLevelChargeVatMap = new TreeMap<>();

	// Frame Amounts
	private Price framePrimSum;
	private Price frameNet;
	private Price frameInsepGross;

	// Area Amounts
	private Price areaPrimSum;
	private Price areaNet;
	private Price areaInsepGross;
	// Unit Amounts
	private Price unitPrimSum;
	private Price unitNet;
	private Price unitInsepGross;

	// Original gesamte Netto- und Steuerbeträge
	private Price originalTotalNet;
	private Price originalTotalVat;

	// Abgerundete gesamte Netto- und Steuerbeträge
	private Price roundedTotalNet;
	private Price roundedTotalVat;

	// Original und abgerundete gesamt Inseparatable Beträge
	private Price originalTotalInsepGross;
	private Price roundedTotalInsepGross;

	// Subtotals Beträge
	private Price unitSubtotalRounded;
	private Price sectionSubtotalRounded;
	private Price billItemGroupSubtotalRounded;


	// netto sum für alle Vertraege
	private Price chargeSubtotalRounded;

	private Price costCentreSumRounded;
	// Wenn nach der Korrektur eine Differenz zwischen TotalNet und korrigiertem Netto besteht, wird diese
	// Differenz zusätzlich in einem DIFF_VAT mit dem Steuersatz 0% berücksichtigt
	private Price additionalDiffVatsAmount;

	/**
	 * Creates a new B2GXmlInvoiceTransformer object. If work multiple input files, use this
	 * standard-constructor
	 */
	public B2GXmlInvoiceTransformer()
	{
		super();
	}


	/**
	 * Creates a new McB2GXmlInvoiceTransformer object.
	 *
	 * @param xmlFile XML-Rechnung als File
	 *
	 * @throws TransformException alle möglichen Fehler
	 */
	public B2GXmlInvoiceTransformer(File xmlFile)
		throws TransformException
	{
		super(xmlFile);
	}

	/**
	 * Creates a new McB2GXmlInvoiceTransformer object.
	 *
	 * @param xmlInputStream XML-Rechnung als InputStream
	 *
	 * @throws TransformException alle möglichen Fehler
	 */
	public B2GXmlInvoiceTransformer(InputStream xmlInputStream)
		throws TransformException
	{
		super(xmlInputStream);
	}

	/**
	 * Creates a new McB2GXmlInvoiceTransformer object.
	 *
	 * @param xmlString XML-Rechnung als String
	 *
	 * @throws TransformException alle möglichen Fehler
	 */
	public B2GXmlInvoiceTransformer(String xmlString)
		throws TransformException
	{
		super(xmlString);
	}

	/**
	 * Main- Methode zum Starten des Transformers als Standalone Application
	 *
	 * @param args Datei-Pfade. Können mehrere sein
	 */
	public static void main(String[] args)
	{
		B2GXmlInvoiceTransformer transformer = new B2GXmlInvoiceTransformer();

		transformer.setCommandLine(null, args);

		for (String fileName : transformer.getCommandLine().getArgs())
		{
			LOGGER.info("{}...", fileName);

			try
			{
				File inputFile = new File(fileName);
				LOGGER.info("File exists: {}", inputFile.exists());
				transformer.init(inputFile);
				transformer.loadNextDocument();
				OutputResult result = transformer.transform();

				if (result != null)
				{
					transformer.writeIntoFile(inputFile.getParent(), result);
				}
			}
			catch (TransformNotAllowedException e)
			{
				LOGGER.warn("transformation is not allowed", e);
			}
			catch (Exception e)
			{
				LOGGER.error("{} aborted!", fileName, e);
			}
		}
	}

	/**
	 * Bearbeitet ein Document als ganzes. Rundet die einzelnen Charges der BillItems ab, berechnet die
	 * Korrekturbeträge und schreibt diese im Element 'DOCUMENT_LEVEL_CHARGES'
	 *
	 * @return Transformierte XML Rechnung, konform zum X-Rechnung Format.
	 *
	 * @throws TransformException alle möglichen Fehler
	 */
	private String calculateCorrectionRates()
		throws TransformException
	{
		Document document = getDocument();

		if (document == null)
		{
			return "";
		}

		LOGGER.info("Starte Berechnung von Korrekturen fuer das Document {}",
			getElement(document.getRootElement(), "/ID/").getTextTrim());

		processFramesElement();
		createTotalAmounts();
		checkTotalSum();
		computeCorrectionRates();
		adjustFramesAmounts();
		adjustDiffVats();
		processDocumentLevelAmounts();
		processPaymentType();


		Format format = Format.getPrettyFormat();
		format.setEncoding(StandardCharsets.ISO_8859_1.name());

		XMLOutputter outputter = new XMLOutputter(format);
		String xmlString = outputter.outputString(document);
		return xmlString.substring(xmlString.indexOf("<DOCUMENT>"));
	}

	private void processPaymentType()
	{
		Element paymentMode = getElement(getRoot(), "/INVOICE_DATA/PAYMENT_MODE/");
		String paymentType = paymentMode.getChildTextTrim("PAYMENT_TYPE");

		if (ZERO_PAYMENT_TYPE.equals(paymentType))
		{
			getElement(paymentMode, "PAYMENT_TYPE").setText(ACH_SAVINGS_CREDITS);
			// Rechnungsnummer aus dem <INVOICE_DEF> -Tag uebernehmen
			String invoiceNumber = getElement(getRoot(), "/HEADER/").getChildTextTrim("INVOICE_DEF");

			Element ledgerAccount = new Element("LEDGER_ACCOUNT").setText(invoiceNumber);
			paymentMode.addContent(ledgerAccount);
		}
		else if (SEPA_PAYMENT_TYPE.equals(paymentType))
		{
			String creditorId = getCreditorIdForBrandGroup(getText(getRoot(), "HEADER/BRAND/GROUP_SHORTCUT"));

			int index = paymentMode.indexOf(paymentMode.getChild("SEPA_MANDATE")) + 1;

			paymentMode.addContent(index, new Element("CREDITOR_ID").setText(creditorId));
		}
	}


	private void processFramesElement()
	{
		Element frames = getElement(getRoot(), "/INVOICE_DATA/FRAMES/");

		// zuerst alle Frame-Elemente bearbeiten
		for (Object frameObj : frames.getChildren("FRAME"))
		{
			framePrimSum = Price.ZERO;
			frameNet = Price.ZERO;
			frameInsepGross = Price.ZERO;

			Element frameElement = (Element) frameObj;
			processAreas(frameElement);

			processAmountsElement(getElement(frameElement, "/AMOUNTS/"), frameNet, framePrimSum, frameInsepGross);
		}
	}


	private void processAmountsElement(Element amountsElement, Price amountNet, Price amountPrimSum, Price amountInsepGross)
	{
		if (amountsElement == null)
		{
			return;
		}

		for (Object oneAmountObj : amountsElement.getChildren("AMOUNT"))
		{
			Element oneAmount = (Element) oneAmountObj;

			if ((getChildWithText(oneAmount, "TOTAL_NET")) != null)
			{
				Element value = oneAmount.getChild("VALUE");
				value.setText(createNodeValueFromPrice(amountNet));
			}
			else if ((getChildWithText(oneAmount, "INSEP_GROSS")) != null)
			{
				Element value = oneAmount.getChild("VALUE");
				value.setText(createNodeValueFromPrice(amountInsepGross));
			}
			else if ((getChildWithText(oneAmount, "PRIMARY_SUM")) != null)
			{
				Element value = oneAmount.getChild("VALUE");
				value.setText(createNodeValueFromPrice(amountPrimSum));
			}
		}
	}


	private void adjustDiffVats()
		throws TransformException
	{
		Element diffVats = getElement(getRoot(), "/INVOICE_DATA/FRAMES/DIFF_VATS");
		Price correctionZeroVatPrice = additionalDiffVatsAmount.add(Price.ZERO);
		int firstElementIndex = -1;

		Price sumNet = Price.ZERO;
		Price sumVat = Price.ZERO;

		for (Object oneDiffVatsObj : diffVats.getChildren("DIFF_VAT"))
		{
			Element oneDiffVat = (Element) oneDiffVatsObj;

			if (firstElementIndex < 0)
			{
				firstElementIndex = diffVats.indexOf(oneDiffVat);
			}

			Percentage vatRate = new Percentage(getElement(oneDiffVat, "VAT_RATE").getTextTrim());
			Price netAmount = roundupPrices.get(vatRate);
			Price correctionNetAmount = documentLevelChargeVatMap.get(vatRate);
			Price adjustedAmount = netAmount.add(correctionNetAmount);
			Price adjustedVat = getGrossPrice(adjustedAmount, vatRate).subtract(adjustedAmount);


			if (vatRate.isZero() && !correctionZeroVatPrice.isZero())
			{
				// Der Preis für Netto-Korrektur mit USst = 0 existiert und zum Netto Preis zum VatRate = 0
				// addiert werden
				adjustedAmount = adjustedAmount.add(correctionZeroVatPrice);
				correctionZeroVatPrice = Price.ZERO;
			}

			getElement(oneDiffVat, "NET").setText(createNodeValueFromPrice(adjustedAmount));
			getElement(oneDiffVat, "VAT").setText(createNodeValueFromPrice(adjustedVat));

			sumNet = sumNet.add(adjustedAmount);
			sumVat = sumVat.add(adjustedVat);
		}

		// finale Prüfung, ob die Summe Bertägen aus DIFF_VATS mit den Originalbeträgen übereinstimmen.
		// Netto-Korrektur zu 0% UsSt. berücksichtigen.
		Price origNetRounded = originalTotalNet.setPrecision(B2G_INVOICE_PRECISION);
		Price origVatRounded = originalTotalVat.setPrecision(B2G_INVOICE_PRECISION);
		Price correctedSumNet = sumNet.add(correctionZeroVatPrice);

		if (!correctedSumNet.equals(origNetRounded))
		{
			throw new TransformException("Der Nettobertag, berechnet aus den DIFF_VAT-Elementen = " + correctedSumNet +
				", stimmt mit dem origilalen Nettobetrag = " + origNetRounded + " nicht überein!");
		}
		else if (!sumVat.equals(origVatRounded))
		{
			throw new TransformException("Der Nettobertag, berechnet aus den DIFF_VAT-Elementen = " + sumVat +
				", stimmt mit dem origilalen Nettobetrag = " + origVatRounded + " nicht überein!");
		}

		if (!correctionZeroVatPrice.isZero())
		{
			// Der Preis für Netto-Korrektur mit VatRate==0 existiert, aber das DIFF_VAT Element dafür
			// existiert noch nicht,
			// deshalb neues DIFF_VAT- Element erstellen und da reinschreiben.

			Element diffVatVatRateZero = new Element("DIFF_VAT");
			diffVatVatRateZero.addContent(new Element("VAT_RATE").setText(Percentage.ZERO.toString()));
			diffVatVatRateZero.addContent(new Element("VAT").setText(createNodeValueFromPrice(Price.ZERO)));
			diffVatVatRateZero.addContent(new Element("NET").setText(createNodeValueFromPrice(correctionZeroVatPrice)));

			diffVats.addContent(firstElementIndex, diffVatVatRateZero);

			// das Element NUMBERS muss um 1 erhöht werden
			int numbers = Integer.parseInt(diffVats.getChild("NUMBERS").getTextTrim());
			diffVats.getChild("NUMBERS").setText(String.valueOf(++numbers));
		}
	}


	private void adjustFramesAmounts()
	{
		// und dann finale Anpassung bei den AMOUNTS- Kinder
		Element amounts = getElement(getRoot(), "/INVOICE_DATA/FRAMES/AMOUNTS");

		for (Object oneAmountObj : amounts.getChildren())
		{
			Element oneAmount = (Element) oneAmountObj;

			if (getChildWithText(oneAmount, "ROUND_UP") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
			else if (getChildWithText(oneAmount, "TOTAL_NET") != null)
			{
				// wurde mit Prezision = BillOutputPrecisions.BILL_TOTALNET_OUTPUT_PRECISION geschrieben.
				// Deshalb 2-stellig abrunden
				Element value = oneAmount.getChild("VALUE");
				Price price = parsePrice(value.getTextTrim());
				value.setText(createNodeValueFromPrice(price.setPrecision(B2G_INVOICE_PRECISION)));
			}
			else if (getChildWithText(oneAmount, "UNPAID") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
			else if (getChildWithText(oneAmount, "SEF_SUM") != null)
			{
				// wurde mit Prezision = BillOutputPrecisions.BILLITEM_OUTPUT_PRECISION geschrieben. Deshalb
				// 2-stellig abrunden
				Element value = oneAmount.getChild("VALUE");
				Price price = parsePrice(value.getTextTrim());
				value.setText(createNodeValueFromPrice(price.setPrecision(B2G_INVOICE_PRECISION)));
			}
			else if (getChildWithText(oneAmount, "INSEP_GROSS") != null)
			{
				// wurde mit Prezision = BillOutputPrecisions.BILLITEM_OUTPUT_PRECISION geschrieben. Deshalb
				// 2-stellig abrunden
				Element value = oneAmount.getChild("VALUE");
				Price price = parsePrice(value.getTextTrim());
				value.setText(createNodeValueFromPrice(price.setPrecision(B2G_INVOICE_PRECISION)));
			}
			else if (getChildWithText(oneAmount, "SUBTOTAL") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
			else if (getChildWithText(oneAmount, "PRIMARY_SUM") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
			else if (getChildWithText(oneAmount, "TOTAL") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
			else if (getChildWithText(oneAmount, "TO_PAY") != null)
			{
				// Der Preis wurde mit Prezision = BillOutputPrecisions.BILLSUM_OUTPUT_PRECISION geschrieben.
				// Deshalb nichts tun
			}
		}
	}


	private void createTotalAmounts()
	{
		for (Map.Entry<Percentage, Price> vatRate : originalPrices.entrySet())
		{
			originalTotalNet = originalTotalNet.add(vatRate.getValue());

			originalTotalVat =
				originalTotalVat.add(vatRate.getValue().percentage(vatRate.getKey()).setPrecision(B2G_INVOICE_PRECISION));
		}

		for (Map.Entry<Percentage, Price> vatRate : roundupPrices.entrySet())
		{
			roundedTotalNet = roundedTotalNet.add(vatRate.getValue());

			roundedTotalVat =
				roundedTotalVat.add(vatRate.getValue().percentage(vatRate.getKey()).setPrecision(B2G_INVOICE_PRECISION));
		}
	}


	private Element getChildWithText(Element parent, String childText)
	{
		Element childWithText = null;

		for (Object oneChild : parent.getChildren())
		{
			if (childText.equals(((Element) oneChild).getTextTrim()))
			{
				childWithText = (Element) oneChild;
				break;
			}
		}

		return childWithText;
	}

	/**
	 * Prüfung, ob die Berechnungen korrekt sind. Der berechnete Originalbertag wird mit BillAmount-Betrag
	 * verglichen. Beide müssen gleich sein, sonst ist etwas nicht berücksichtigt worden.
	 */
	private void checkTotalSum()
		throws TransformException
	{
		Element frames = getElement(getRoot(), "/INVOICE_DATA/FRAMES/");
		Element amounts = getElement(frames, "/AMOUNTS/");

		Price toTest = null;

		for (Object amountObj : amounts.getChildren("AMOUNT"))
		{
			Element amount = (Element) amountObj;
			toTest = parsePrice(getElement(amount, "VALUE").getTextTrim());

			if ("TOTAL_NET".equalsIgnoreCase(getElement(amount, "TYPE").getTextTrim()))
			{
				if (!toTest.equals(originalTotalNet))
				{
					throw new TransformException("Fehler in der Berechnung. Der original TOTAL_NET muss " + toTest.toString() +
						"betragen, berechnet wurde " + originalTotalNet.toString());
				}
			}
			else if ("TOTAL_VAT".equalsIgnoreCase(getElement(amount, "TYPE").getTextTrim()))
			{
				if (!toTest.equals(originalTotalVat))
				{
					throw new TransformException("Fehler in der Berechnung. Der original TOTAL muss " + toTest.toString() +
						"betragen, berechnet wurde " + originalTotalVat.toString());
				}
			}
			else if ("INSEP_GROSS".equalsIgnoreCase(getElement(amount, "TYPE").getTextTrim()) &&
				!toTest.equals(originalTotalInsepGross))
			{
				throw new TransformException("Fehler in der Berechnung. Der original INSEP_GROSS muss " + toTest.toString() +
					"betragen, berechnet wurde " + originalTotalInsepGross.toString());
			}
		}
	}

	/**
	 * Berechnung der Korrektur bei Abweichungen zwischen den original und abgerundeten Beträgen nach
	 * bestimmter Formel. Diese Korrekturen werden in einem extra-Element namens DOCUMENT_LEVEL_CHARGES als
	 * direktes Kind von 'FRAMES'-Element geschrieben.
	 */
	private void computeCorrectionRates()
	{
		// wenn der original Nettogesamtbetrag = 0 - keine Differenzen berechnen
		if (Price.ZERO.equals(originalTotalNet))
		{
			return;
		}

		// Original GesamtBrutto
		Price originalTotal = originalTotalVat.add(originalTotalNet);
		// Gesamtbrutto gerundet
		Price roundedTotal = roundedTotalVat.add(roundedTotalNet);

		// Different zwischen dem original und gerundetem GesamtNetto
		Price diffNetOrigToRounded = originalTotalNet.subtract(roundedTotalNet);

		// Different zwischen dem original und gerundetem GesamtBrutto
		Price diffVatOrigToRounded = originalTotal.subtract(roundedTotal);

		for (Entry<Percentage, Price> entry : originalPrices.entrySet())
		{
			Percentage vatRate = entry.getKey();
			Price originalPrice = entry.getValue();
			Price origVatRateAmount = originalPrice.percentage(vatRate).setPrecision(B2G_INVOICE_PRECISION);
			LOGGER.debug("Originalpreis für die USt. von {}% beträgt {} Euro", vatRate, originalPrice);

			Price roundedPrice = roundupPrices.get(vatRate);
			LOGGER.debug("Abgerundeter Preis für die USt. von {}% beträgt {} Euro", vatRate, roundedPrice);

			// Diferrenz = OriginalPreis-Abgerundeter Preis
			Price differenceAmount = originalPrice.subtract(roundedPrice);

			// Wenn die Differenz negativ ist, muss correctionByVatRate ebenso negativ sein.
			long sign = differenceAmount.isNegative() ? -1 : 1;

			LOGGER.debug("Differenz zwischen Original- und abgerundetem Preis für die USt. von {}% beträgt {} Euro", vatRate,
				differenceAmount);

			Percentage diffAsPercent =
				new Percentage(differenceAmount.setPrecision(BILL_TOTALNET_VAT_CALCULATE_PRECISION)
					.divide(diffNetOrigToRounded.setPrecision(BILL_TOTALNET_VAT_CALCULATE_PRECISION).doubleValue())
					.multiply(100L)
					.abs()
					.toString());
			LOGGER.debug(
				"Übereinstimmung zwischen Original- und abgerundetem Preis für die USt. von {}% in Prozent zum Gesamtpreis beträgt {}%",
				vatRate, diffAsPercent);

			Price correctionByVatRate =
				diffVatOrigToRounded.multiply(diffAsPercent.doubleValue())
					.divide(100L)
					.setPrecision(B2G_INVOICE_PRECISION)
					.decrease(vatRate)
					.multiply(sign);

			Price correctedVatPriceDiff =
				roundedPrice.add(correctionByVatRate)
					.percentage(vatRate)
					.setPrecision(B2G_INVOICE_PRECISION)
					.subtract(origVatRateAmount);

			// Der korrigierte USt.-Betrag muss genau dem originalen entsprechen.
			// Wenn nicht - die Differenz als Netto vom correctionByVatRate abziehen
			while (!correctedVatPriceDiff.isZero())
			{
				Price correctedNetPriceDiff = correctedVatPriceDiff.decrease(vatRate).setPrecision(B2G_INVOICE_PRECISION);
				correctionByVatRate = correctionByVatRate.subtract(correctedNetPriceDiff);
				correctedVatPriceDiff =
					roundedPrice.add(correctionByVatRate)
						.percentage(vatRate)
						.setPrecision(B2G_INVOICE_PRECISION)
						.subtract(origVatRateAmount);
			}

			additionalDiffVatsAmount = additionalDiffVatsAmount.add(differenceAmount.subtract(correctionByVatRate));

			documentLevelChargeVatMap.put(vatRate, correctionByVatRate);
		}

		additionalDiffVatsAmount = additionalDiffVatsAmount.setPrecision(B2G_INVOICE_PRECISION);

		if (!additionalDiffVatsAmount.isZero())
		{
			Price zeroVatRateAmount = documentLevelChargeVatMap.get(Percentage.ZERO);

			if (zeroVatRateAmount == null)
			{
				documentLevelChargeVatMap.put(Percentage.ZERO, additionalDiffVatsAmount);
			}
			else
			{
				documentLevelChargeVatMap.put(Percentage.ZERO, zeroVatRateAmount.add(additionalDiffVatsAmount));
			}
		}
	}

	/**
	 * Erstellen eines DOCUMENT_LEVEL_CHARGES -Elements und befüllen es mit Kinder-Elementen, Jedes
	 * Kind-Element entspricht einem Netto-Korrekturbertag füe einen bestimmten Steuersatz. Hinzugefügt werden
	 * nur Kinderelemente dessen Korrekturbetrag != 0 ist.
	 */
	private void processDocumentLevelAmounts()
	{
		Collection<Element> documentLevelCharges = new ArrayList<>();
		Collection<Element> documentLevelAllowences = new ArrayList<>();

		documentLevelChargeVatMap.entrySet()
			.stream()
			.filter(e -> !e.getValue().isZero())
			.forEach(e -> (e.getValue().isPositive() ? documentLevelCharges : documentLevelAllowences)
				.add(createDocumentLevelAmount(e.getValue(), e.getKey())));

		Element frames = getElement(getRoot(), "/INVOICE_DATA/FRAMES/");
		int indexOfDiffVats = frames.indexOf(getElement(frames, "/DIFF_VATS/"));
		frames.addContent(++indexOfDiffVats, new Element("DOCUMENT_LEVEL_CHARGES").addContent(documentLevelCharges));
		frames.addContent(++indexOfDiffVats, new Element("DOCUMENT_LEVEL_ALLOWENCES").addContent(documentLevelAllowences));

		Price totalDocumentLevelCharge =
			documentLevelChargeVatMap.values()
				.stream()
				.filter(Price::isPositive)
				.reduce(Price.ZERO.setPrecision(B2G_INVOICE_PRECISION), Price::add);

		if (!totalDocumentLevelCharge.isZero())
		{
			insertTotalDocumentLevelChargesIntoAmounts(totalDocumentLevelCharge);
		}

		Price totalDocumentLevelAllowence =
			documentLevelChargeVatMap.values()
				.stream()
				.filter(Price::isNegative)
				.reduce(Price.ZERO.setPrecision(B2G_INVOICE_PRECISION), Price::add);

		if (!totalDocumentLevelAllowence.isZero())
		{
			insertTotalDocumentLevelAllowenceIntoAmounts(totalDocumentLevelAllowence.abs());
		}
	}

	private Element createDocumentLevelAmount(Price price, Percentage vatRate)
	{
		Element documentLevelAmount = new Element(price.isPositive() ? "DOCUMENT_LEVEL_CHARGE" : "DOCUMENT_LEVEL_ALLOWENCE");

		documentLevelAmount.addContent(new Element("CHARGE").setText(createNodeValueFromPrice(price.abs())));
		documentLevelAmount.addContent(new Element("VAT_RATE").setText(vatRate.toString()));
		documentLevelAmount
			.addContent(new Element("REASON").setText("Ausgleich der Rundungsdifferenz auf Grund zweistelliger Nettobeträge"));

		return documentLevelAmount;
	}

	private void insertTotalDocumentLevelChargesIntoAmounts(Price totalDocumentLevelCharge)
	{
		Element amounts = getElement(getRoot(), "/INVOICE_DATA/FRAMES/AMOUNTS/");

		Element totalDocLevelChargeAmount = new Element("AMOUNT");
		totalDocLevelChargeAmount.addContent(new Element("TYPE").setText("TOTAL_DOCUMENT_LEVEL_CHARGES"));
		totalDocLevelChargeAmount.addContent(new Element("VALUE").setText(createNodeValueFromPrice(totalDocumentLevelCharge)));

		amounts.addContent(totalDocLevelChargeAmount);
	}

	private void insertTotalDocumentLevelAllowenceIntoAmounts(Price totalDocumentLevelAllowence)
	{
		Element amounts = getElement(getRoot(), "/INVOICE_DATA/FRAMES/AMOUNTS/");

		Element totalDocLevelChargeAmount = new Element("AMOUNT");
		totalDocLevelChargeAmount.addContent(new Element("TYPE").setText("TOTAL_DOCUMENT_LEVEL_ALLOWENCES"));
		totalDocLevelChargeAmount
			.addContent(new Element("VALUE").setText(createNodeValueFromPrice(totalDocumentLevelAllowence)));

		amounts.addContent(totalDocLevelChargeAmount);
	}

	/**
	 * Abarbeiten alle Area-Elemente in einem Frame- Element . Aktualisierung Frame-Amounts
	 */
	private void processAreas(Element frame)
	{
		for (Object areaObj : frame.getChildren("AREA"))
		{
			areaPrimSum = Price.ZERO;
			areaNet = Price.ZERO;
			areaInsepGross = Price.ZERO;

			Element areaElement = (Element) areaObj;

			processUnits(areaElement);

			processAmountsElement(getElement(areaElement, "/AMOUNTS/"), areaNet, areaPrimSum, areaInsepGross);

			framePrimSum = framePrimSum.add(areaPrimSum);
			frameNet = frameNet.add(areaNet);
			frameInsepGross = frameInsepGross.add(areaInsepGross);
		}
	}

	/**
	 * Abarbeiten alle Unit-Elemente in einem Area- Element . Aktualisierung Area-Amounts
	 */
	private void processUnits(Element area)
	{
		for (Object unitObj : area.getChildren("UNIT"))
		{
			unitSubtotalRounded = Price.ZERO;
			unitPrimSum = Price.ZERO;
			unitNet = Price.ZERO;
			unitInsepGross = Price.ZERO;

			Element unitElement = (Element) unitObj;

			processSections(getElement(unitElement, "/SECTIONS/"));

			unitPrimSum = unitNet.add(unitInsepGross);

			processAmountsElement(getElement(unitElement, "/AMOUNTS/"), unitNet, unitPrimSum, unitInsepGross);

			areaPrimSum = areaPrimSum.add(unitPrimSum);
			areaNet = areaNet.add(unitNet);
			areaInsepGross = areaInsepGross.add(unitInsepGross);
		}
	}

	/**
	 * Abarbeiten alle Section-Elemente in einem Unit- Element.
	 */
	private void processSections(Element sections)
	{
		for (Object sectionObj : sections.getChildren("SECTION"))
		{
			sectionSubtotalRounded = Price.ZERO;
			Element sectionElement = (Element) sectionObj;

			processBillItemGroups(sectionElement.getChild("BILLITEM_GRPS"));

			sectionElement.getChild("SUBTOTAL").setText(createNodeValueFromPrice(sectionSubtotalRounded));
		}
	}

	/**
	 * Abarbeiten alle BillItemGroup-Elemente in einem BillItemGroups- Element.
	 */

	private void processBillItemGroups(Element billItemGrps)
	{
		for (Object oneBillItemGrpObj : billItemGrps.getChildren("BILLITEM_GRP"))
		{
			billItemGroupSubtotalRounded = Price.ZERO;
			Element oneBillItemGrp = (Element) oneBillItemGrpObj;
			Element charge = oneBillItemGrp.getChild("CHARGE");

			// Nicht alle BILLITEMs sind Abrechnungseinheiten und haben ein <VAT_RATE> -Element.
			// Z.B. bei den Vouchers gibt es dieses Element nicht.
			// Solche BILLITEMS werden hier ignoriert und nicht zu Price Maps hinzugefuegt.
			// Falls es bei der BILLITEM- Gruppe kein <CHARGE> Element gibt -handelt es sich um solche
			// BILLITEMs.
			if (charge != null)
			{
				processBillItemGroup(oneBillItemGrp);
				charge.setText(createNodeValueFromPrice(billItemGroupSubtotalRounded));
			}
		}
	}

	/**
	 * Abarbeiten alle BillItem -Elemente in einem BillItemGroup- Element. Abrunden von Charges und Berechnen
	 * von UNIT_SUBTOTAL, CHARGE_SUBTOTAL und ggf. FRAME_SUBTOTAL Aktualisierung der Unit-Amounts und
	 * TotalMaps für Netto und Umsatzsteuer- Beträge.
	 */
	private void processBillItemGroup(Element billItemGroup)
	{
		for (Object billitemObj : getElement(billItemGroup, "BILLITEMS").getChildren("BILLITEM"))
		{
			Element billItem = (Element) billitemObj;

			Element chargeNode = getElement(billItem, "CHARGE");
			Element vatRateNode = getElement(billItem, "VAT_RATE");
			Element discountNode = getElement(billItem, "DISCOUNT");
			Element subtotalNode = getElement(billItem, "SUBTOTALS/CHARGE_SUBTOTAL");
			Element unitSubtotalNode = getElement(billItem, "SUBTOTALS/UNIT_SUBTOTAL");
			Element frameSubtotalNode = getElement(billItem, "SUBTOTALS/FRAME_SUBTOTAL");


			Price chargeNodePrice = parsePrice(getCharge(billItem));
			Price chargeNodePriceRounded = chargeNodePrice.setPrecision(B2G_INVOICE_PRECISION, HALF_UP);
			String vatRateString = vatRateNode.getTextTrim();

			if ("INCLUDED".equals(vatRateString))
			{
				originalTotalInsepGross = originalTotalInsepGross.add(chargeNodePrice);
				roundedTotalInsepGross = roundedTotalInsepGross.add(chargeNodePriceRounded);
				unitInsepGross = unitInsepGross.add(chargeNodePriceRounded);
			}
			else
			{
				Percentage vatRatePercent = new Percentage(vatRateNode.getTextTrim());
				unitNet = unitNet.add(chargeNodePriceRounded);
				updatePriceMaps(vatRatePercent, chargeNodePrice, chargeNodePriceRounded);
			}

			chargeNode.setText(createNodeValueFromPrice(chargeNodePriceRounded));

			if (discountNode != null)
			{
				Price discount = parsePrice(discountNode.getTextTrim()).setPrecision(B2G_INVOICE_PRECISION);
				discountNode.setText(createNodeValueFromPrice(discount));
			}

			billItemGroupSubtotalRounded = billItemGroupSubtotalRounded.add(chargeNodePriceRounded);

			unitSubtotalRounded = unitSubtotalRounded.add(chargeNodePriceRounded);
			unitSubtotalNode.setText(createNodeValueFromPrice(unitSubtotalRounded));

			chargeSubtotalRounded = chargeSubtotalRounded.add(chargeNodePriceRounded);
			subtotalNode.setText(createNodeValueFromPrice(chargeSubtotalRounded));

			sectionSubtotalRounded = sectionSubtotalRounded.add(chargeNodePriceRounded);

			if (frameSubtotalNode != null)
			{
				costCentreSumRounded = costCentreSumRounded.add(chargeNodePriceRounded);
				frameSubtotalNode.setText(createNodeValueFromPrice(costCentreSumRounded));
			}
		}
	}

	/**
	 * Aktualisierung von gesamten originalen und abgerundeten Netto und Umsatzsteuer Beträgen je Steuersatz
	 */
	private void updatePriceMaps(Percentage vatRate, Price originalCharge, Price roundedCharge)
	{
		Price originalVatRateCharge = originalPrices.get(vatRate);

		if (originalVatRateCharge == null)
		{
			originalVatRateCharge = Price.ZERO;
		}

		originalPrices.put(vatRate, originalVatRateCharge.add(originalCharge));

		Price roundupVatRateCharge = roundupPrices.get(vatRate);

		if (roundupVatRateCharge == null)
		{
			roundupVatRateCharge = Price.ZERO;
		}

		roundupPrices.put(vatRate, roundupVatRateCharge.add(roundedCharge));
	}

	private String createNodeValueFromPrice(Price price)
	{
		PriceFormat priceFormat = new PriceFormat(Locale.GERMAN, false);

		// Die Methode priceFormat.format(price) liefert am letzten Index der Zeichekette ein non-breaking
		// Whitespace. Dieses Zeichen ist kein Whitespace und kann mit der trim()- Methode nicht entfernt
		// werden. Mit Blick auf mögliche Korrektur dieses Verhalten in der Zukunft wird das letzte Zeichen
		// nicht einfach entfernt, sondern durch Verkettung von replace() und trim() ausgefiltert
		return priceFormat.format(price).replace('\u00A0', ' ').trim();
	}


	@Override
	public OutputResult transform(boolean header)
		throws TransformException
	{
		// gleich calculateCorrectionRates aufrufen, da die Methode loadNextDocument() von McBillOutXml
		// beerits aufgerufen worden sein kann.
		StringBuilder stringBuilder =
			new StringBuilder().append(XML_PROCESSOR_LINE)
				.append("<DOCUMENTS>")
				.append(LINE_SEPARATOR)
				.append(calculateCorrectionRates());

		while (hasNextDocument())
		{
			try
			{
				loadNextDocument();
			}
			catch (TransformNotAllowedException e)
			{
				throw new TransformException("Fehler beim Laden des nächsten Dokuments", e);
			}

			stringBuilder.append(calculateCorrectionRates());
		}

		stringBuilder.append("</DOCUMENTS>");
		String result = stringBuilder.toString();
		// Nach dem Formattieren mit dem pretty -Format Leerzeichen an Anfang jeder Zeile entfernen
		result = result.replaceAll("(\\r?\\n)(\\s+)(\\<)", "$1$3");

		return new AtomicOutputResult(getInputXmlFileName(), result);
	}


	@Override
	public void initForNewDocument()
		throws TransformException, TransformNotAllowedException
	{
		super.initForNewDocument();
		framePrimSum = Price.ZERO;
		frameNet = Price.ZERO;
		frameInsepGross = Price.ZERO;

		areaPrimSum = Price.ZERO;
		areaNet = Price.ZERO;
		areaInsepGross = Price.ZERO;

		unitPrimSum = Price.ZERO;
		unitNet = Price.ZERO;
		unitInsepGross = Price.ZERO;

		originalPrices.clear();
		roundupPrices.clear();
		documentLevelChargeVatMap.clear();
		unitSubtotalRounded = Price.ZERO;
		sectionSubtotalRounded = Price.ZERO;
		billItemGroupSubtotalRounded = Price.ZERO;
		chargeSubtotalRounded = Price.ZERO;
		costCentreSumRounded = Price.ZERO;

		originalTotalNet = Price.ZERO;
		roundedTotalNet = Price.ZERO;

		originalTotalVat = Price.ZERO;
		roundedTotalVat = Price.ZERO;

		originalTotalInsepGross = Price.ZERO;
		roundedTotalInsepGross = Price.ZERO;
		additionalDiffVatsAmount = Price.ZERO;
	}
}

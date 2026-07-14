# Sales Data Analyzer (Intermediate)

**File:** `3_Intermediate_Sales_Data_Analyzer.ipynb`
**Level:** Intermediate

A data analysis project that examines sales data to find top-selling products, best-performing regions, and monthly revenue trends — using Pandas and Matplotlib.

## What You'll Learn

- Loading and exploring data with Pandas (`DataFrame`, `describe()`, `dtypes`)
- Grouping and aggregating data (`groupby`, `sum`, `agg`)
- Data visualization: bar chart, pie chart, line chart
- Turning analysis into a readable business insights summary

## Features

- Auto-generates sample sales data (no external file needed to run)
- Product-wise revenue analysis with bar chart
- Region-wise revenue share with pie chart
- Month-wise revenue trend with line chart
- Automated insights report (top product, top region, best month)

## Tech Stack

- Python 3
- `pandas`, `numpy`, `matplotlib`

## How to Run

1. Download `3_Intermediate_Sales_Data_Analyzer.ipynb`.
2. Open [Google Colab](https://colab.research.google.com/).
3. Upload the notebook (`File → Upload notebook`).
4. Run the cells in order (`Runtime → Run all`, or run cell by cell).

No installation needed — Colab already has `pandas`, `numpy`, and `matplotlib` pre-installed.

> To use your own data instead of the sample data, replace the sample data cell with `pd.read_csv("your_file.csv")`.

## Practice Exercises

1. **Easy:** Find the least-selling product (lowest revenue) and highlight it on the graph.
2. **Medium:** Find the "best month" separately for each region (hint: `groupby(["Region","Month"])`).
3. **Hard:** Train a simple Linear Regression model (using `sklearn`) to predict next month's revenue based on units sold.

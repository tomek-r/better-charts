use super::*;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

#[test]
fn an_amount_that_already_has_one_figure_is_left_alone() {
    for text in ["1", "0.5", "7000", "0.007"] {
        assert_eq!(
            round_to_one_significant_figure(price(text)),
            price(text),
            "{text} is already one significant figure"
        );
    }
}

#[test]
fn a_digit_below_five_rounds_the_amount_down_to_its_figure() {
    let rounded = [
        ("8194.97", "8000"),
        ("3097.45", "3000"),
        ("949", "900"),
        ("14.9", "10"),
    ];
    for (amount, expected) in rounded {
        assert_eq!(
            round_to_one_significant_figure(price(amount)),
            price(expected),
            "{amount} rounds down to {expected}"
        );
    }
}

#[test]
fn a_digit_of_five_or_more_rounds_the_amount_up_to_its_figure() {
    let rounded = [
        ("6999.27", "7000"),
        ("95", "100"),
        ("15", "20"),
        ("0.0067447", "0.007"),
    ];
    for (amount, expected) in rounded {
        assert_eq!(
            round_to_one_significant_figure(price(amount)),
            price(expected),
            "{amount} rounds up to {expected}"
        );
    }
}

#[test]
fn an_exact_half_rounds_away_from_zero() {
    assert_eq!(
        round_to_one_significant_figure(price("950")),
        price("1000"),
        "950 sits exactly between 900 and 1000 and takes the larger one"
    );
    assert_eq!(
        round_to_one_significant_figure(price("0.00095")),
        price("0.001"),
        "0.00095 is 9.5 ten-thousandths, which rounds to one thousandth"
    );
}

#[test]
fn a_zero_amount_stays_zero() {
    assert_eq!(
        round_to_one_significant_figure(Decimal::ZERO),
        Decimal::ZERO,
        "a box that was never computed is still no box"
    );
}

#[test]
fn the_smallest_amount_keeps_its_figure() {
    let smallest = Decimal::new(1, 28);
    assert_eq!(
        round_to_one_significant_figure(smallest),
        smallest,
        "a positive amount never rounds down to the zero box a chart refuses"
    );
}
